import { createReadStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { google } from "googleapis";

/**
 * Écriture dans Google Drive. Drive tient lieu de base de données : les
 * métadonnées d'un clip voyagent avec le fichier, dans ses `appProperties`.
 *
 * Arborescence créée automatiquement sous le dossier racine partagé :
 *   clips/ thumbs/ meta/ live/
 */

const FOLDERS = ["clips", "thumbs", "meta", "live"];

/** Encode les temps par zone en une chaîne courte : "maison:120|bassin:40". */
export function encodeZones(zoneSeconds) {
  return Object.entries(zoneSeconds)
    .filter(([, seconds]) => seconds >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([zone, seconds]) => `${zone.slice(0, 14)}:${Math.round(seconds)}`)
    .join("|")
    .slice(0, 120);
}

export class DriveStore {
  constructor({ config, logger }) {
    this.rootId = config.drive.rootFolderId;
    this.keyFile = config.drive.serviceAccountFile;
    this.log = logger;
    this.folders = {};
    this.drive = null;
  }

  async init() {
    const credentials = JSON.parse(readFileSync(this.keyFile, "utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    this.drive = google.drive({ version: "v3", auth });

    for (const name of FOLDERS) {
      this.folders[name] = await this.#ensureFolder(name);
    }
    this.log.info(`Drive prêt (racine ${this.rootId})`);
  }

  async #ensureFolder(name) {
    const found = await this.drive.files.list({
      q: `'${this.rootId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (found.data.files?.[0]?.id) return found.data.files[0].id;

    const created = await this.drive.files.create({
      requestBody: {
        name,
        parents: [this.rootId],
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
      supportsAllDrives: true,
    });
    this.log.info(`Dossier Drive créé : ${name}`);
    return created.data.id;
  }

  async #findByName(parentId, name) {
    const res = await this.drive.files.list({
      q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return res.data.files?.[0]?.id ?? null;
  }

  /** Envoie un fichier local dans un sous-dossier, avec ses métadonnées. */
  async upload(folder, path, { name, mimeType, appProperties }) {
    const res = await this.drive.files.create({
      requestBody: {
        name: name ?? basename(path),
        parents: [this.folders[folder]],
        appProperties: { app: "turtlecam", ...appProperties },
      },
      media: { mimeType, body: createReadStream(path) },
      fields: "id, size",
      supportsAllDrives: true,
    });
    return { id: res.data.id, size: Number(res.data.size ?? 0) };
  }

  /** Crée ou remplace un fichier dont le nom fait office d'identifiant. */
  async putContent(folder, name, buffer, mimeType, appProperties = {}) {
    const existing = await this.#findByName(this.folders[folder], name);
    const media = { mimeType, body: bufferToStream(buffer) };
    if (existing) {
      await this.drive.files.update({
        fileId: existing,
        requestBody: { appProperties: { app: "turtlecam", ...appProperties } },
        media,
        supportsAllDrives: true,
      });
      return existing;
    }
    const created = await this.drive.files.create({
      requestBody: {
        name,
        parents: [this.folders[folder]],
        appProperties: { app: "turtlecam", ...appProperties },
      },
      media,
      fields: "id",
      supportsAllDrives: true,
    });
    return created.data.id;
  }

  putJson(name, value, appProperties = {}) {
    return this.putContent(
      "meta",
      name,
      Buffer.from(JSON.stringify(value, null, 2)),
      "application/json",
      appProperties,
    );
  }

  putLiveSnapshot(jpeg) {
    return this.putContent("live", "live.jpg", jpeg, "image/jpeg");
  }

  /** Nombre et volume total des clips conservés. */
  async usage() {
    let count = 0;
    let bytes = 0;
    let pageToken;
    do {
      const res = await this.drive.files.list({
        q: `'${this.folders.clips}' in parents and trashed = false`,
        fields: "nextPageToken, files(size)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const file of res.data.files ?? []) {
        count += 1;
        bytes += Number(file.size ?? 0);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return { count, bytes };
  }

  /**
   * Rotation : supprime les clips et vignettes plus vieux que `retentionDays`.
   * Les résumés quotidiens sont conservés bien plus longtemps (quelques Ko par
   * jour) car ils alimentent l'analyse d'habitudes.
   */
  async rotate(retentionDays, summaryRetentionDays) {
    const clipCutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    let deleted = 0;

    for (const folder of ["clips", "thumbs"]) {
      const res = await this.drive.files.list({
        q: `'${this.folders[folder]}' in parents and trashed = false and createdTime < '${clipCutoff}'`,
        fields: "files(id, name)",
        pageSize: 500,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const file of res.data.files ?? []) {
        await this.drive.files.delete({ fileId: file.id, supportsAllDrives: true });
        deleted += 1;
      }
    }

    const metaCutoff = new Date(Date.now() - summaryRetentionDays * 86_400_000).toISOString();
    const meta = await this.drive.files.list({
      q: `'${this.folders.meta}' in parents and trashed = false and createdTime < '${metaCutoff}' and name contains 'daily-'`,
      fields: "files(id)",
      pageSize: 500,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of meta.data.files ?? []) {
      await this.drive.files.delete({ fileId: file.id, supportsAllDrives: true });
      deleted += 1;
    }

    if (deleted > 0) this.log.info(`Rotation : ${deleted} fichiers supprimés de Drive`);
    return deleted;
  }
}

function bufferToStream(buffer) {
  return Readable.from(buffer);
}
