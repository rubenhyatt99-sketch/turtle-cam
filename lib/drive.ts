import { google, type drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import type { AgentStatus, Clip, DailySummary } from "./types";

/**
 * Accès en lecture à Google Drive, qui sert de source de vérité unique :
 * l'agent local y écrit les clips et les métadonnées, le portail les lit.
 * Aucune base de données n'est nécessaire.
 *
 * Arborescence attendue sous `DRIVE_ROOT_FOLDER_ID` :
 *   clips/   fichiers MP4 (métadonnées dans `appProperties`)
 *   thumbs/  vignettes JPEG
 *   meta/    daily-YYYY-MM-DD.json, status.json
 *   live/    live.jpg (image quasi temps réel)
 */

export const FOLDERS = ["clips", "thumbs", "meta", "live"] as const;
export type FolderName = (typeof FOLDERS)[number];

let client: drive_v3.Drive | null = null;

function drive(): drive_v3.Drive {
  if (client) return client;
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!encoded) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 manquant.");
  const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  client = google.drive({ version: "v3", auth });
  return client;
}

function rootId(): string {
  const id = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("DRIVE_ROOT_FOLDER_ID manquant.");
  return id;
}

/** Petit cache mémoire, valable pour la durée de vie de l'instance serverless. */
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Identifiant d'un sous-dossier de la racine, résolu par son nom. */
export async function folderId(name: FolderName): Promise<string | null> {
  return cached(`folder:${name}`, 10 * 60_000, async () => {
    const escaped = name.replace(/'/g, "\\'");
    const res = await drive().files.list({
      q: `'${rootId()}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return res.data.files?.[0]?.id ?? null;
  });
}

/** Décode la chaîne compacte "maison:120|bassin:40" écrite par l'agent. */
function parseZones(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  const zones: Record<string, number> = {};
  for (const part of raw.split("|")) {
    const [zone, seconds] = part.split(":");
    if (zone && seconds) zones[zone] = Number(seconds) || 0;
  }
  return zones;
}

function toClip(file: drive_v3.Schema$File): Clip {
  const props = file.appProperties ?? {};
  const startedAt = props.t0
    ? new Date(Number(props.t0)).toISOString()
    : (file.createdTime ?? new Date(0).toISOString());
  return {
    id: file.id!,
    name: file.name ?? "clip.mp4",
    startedAt,
    durationMs: Number(props.dur ?? 0),
    sizeBytes: Number(file.size ?? 0),
    day: props.day ?? startedAt.slice(0, 10),
    motionScore: Number(props.score ?? 0),
    zoneSeconds: parseZones(props.z),
    thumbId: props.thumb ?? null,
  };
}

export type ClipQuery = {
  /** Filtre sur un jour local (YYYY-MM-DD). */
  day?: string;
  /** Ne renvoyer que les clips touchant cette zone. */
  zone?: string;
  limit?: number;
  pageToken?: string;
};

export async function listClips(query: ClipQuery = {}): Promise<{ clips: Clip[]; nextPageToken: string | null }> {
  const parent = await folderId("clips");
  if (!parent) return { clips: [], nextPageToken: null };

  const filters = [`'${parent}' in parents`, "trashed = false", "mimeType contains 'video/'"];
  if (query.day && /^\d{4}-\d{2}-\d{2}$/.test(query.day)) {
    filters.push(`appProperties has { key='day' and value='${query.day}' }`);
  }

  const res = await drive().files.list({
    q: filters.join(" and "),
    fields: "nextPageToken, files(id, name, size, createdTime, appProperties)",
    orderBy: "createdTime desc",
    pageSize: Math.min(Math.max(query.limit ?? 60, 1), 200),
    pageToken: query.pageToken,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let clips = (res.data.files ?? []).map(toClip);
  if (query.zone) clips = clips.filter((clip) => (clip.zoneSeconds[query.zone!] ?? 0) > 0);
  return { clips, nextPageToken: res.data.nextPageToken ?? null };
}

/** Lit un fichier JSON du dossier `meta/`. */
async function readMetaJson<T>(name: string, ttlMs: number): Promise<T | null> {
  return cached(`meta:${name}`, ttlMs, async () => {
    const parent = await folderId("meta");
    if (!parent) return null;
    const escaped = name.replace(/'/g, "\\'");
    const list = await drive().files.list({
      q: `'${parent}' in parents and name = '${escaped}' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const id = list.data.files?.[0]?.id;
    if (!id) return null;
    const res = await drive().files.get(
      { fileId: id, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    try {
      return JSON.parse(res.data as unknown as string) as T;
    } catch {
      return null;
    }
  });
}

export function getDailySummary(day: string): Promise<DailySummary | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Promise.resolve(null);
  // Les journées passées ne changent plus : on les garde plus longtemps en cache.
  const isToday = day === new Date().toISOString().slice(0, 10);
  return readMetaJson<DailySummary>(`daily-${day}.json`, isToday ? 60_000 : 30 * 60_000);
}

export function getStatus(): Promise<AgentStatus | null> {
  return readMetaJson<AgentStatus>("status.json", 15_000);
}

/** Récupère les résumés des `days` derniers jours, du plus ancien au plus récent. */
export async function getRecentSummaries(days: number): Promise<DailySummary[]> {
  const wanted: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000);
    wanted.push(date.toISOString().slice(0, 10));
  }
  const summaries = await Promise.all(wanted.map((day) => getDailySummary(day)));
  return summaries.filter((summary): summary is DailySummary => summary !== null);
}

/** Métadonnées minimales d'un fichier, pour valider un accès avant streaming. */
export async function fileMeta(fileId: string): Promise<{ size: number; mimeType: string; parents: string[] } | null> {
  try {
    const res = await drive().files.get({
      fileId,
      fields: "size, mimeType, parents",
      supportsAllDrives: true,
    });
    return {
      size: Number(res.data.size ?? 0),
      mimeType: res.data.mimeType ?? "application/octet-stream",
      parents: res.data.parents ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Ouvre un fichier Drive en flux, en relayant l'en-tête `Range` pour que le
 * lecteur vidéo puisse se déplacer dans le clip sans le télécharger en entier.
 */
export async function streamFile(
  fileId: string,
  range?: string,
): Promise<{ body: ReadableStream<Uint8Array>; headers: Record<string, string>; status: number }> {
  const res = await drive().files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream", headers: range ? { Range: range } : undefined },
  );

  const headers: Record<string, string> = {};
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = res.headers[key];
    if (typeof value === "string") headers[key] = value;
  }
  headers["accept-ranges"] ??= "bytes";

  const body = Readable.toWeb(res.data as unknown as Readable) as ReadableStream<Uint8Array>;
  return { body, headers, status: res.status === 206 ? 206 : 200 };
}

/** Dernière image "live" poussée par l'agent, ou `null` si absente. */
export async function getLiveSnapshotId(): Promise<string | null> {
  return cached("live:snapshot", 5_000, async () => {
    const parent = await folderId("live");
    if (!parent) return null;
    const res = await drive().files.list({
      q: `'${parent}' in parents and name = 'live.jpg' and trashed = false`,
      fields: "files(id, modifiedTime)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return res.data.files?.[0]?.id ?? null;
  });
}
