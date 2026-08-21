import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DriveStore } from "./drive.js";

/**
 * Stockage local, alternative à Google Drive.
 *
 * Il expose exactement la même interface que `DriveStore`, ce qui permet de
 * faire tourner toute la chaîne — détection, enregistrement, analyse, rotation
 * — sans compte de service ni réseau. Utile pour valider l'installation avant
 * de brancher le cloud, ou pour rester entièrement hors ligne.
 *
 * Arborescence, identique à celle de Drive :
 *   data/clips/   clips MP4 + un sidecar .json par clip pour les métadonnées
 *   data/thumbs/  vignettes
 *   data/meta/    daily-YYYY-MM-DD.json, status.json
 *   data/live/    live.jpg
 */
export class LocalStore {
  constructor({ config, logger }) {
    this.root = config.storage.localDir;
    this.log = logger;
    this.folders = {};
  }

  async init() {
    for (const name of ["clips", "thumbs", "meta", "live"]) {
      this.folders[name] = join(this.root, name);
      await mkdir(this.folders[name], { recursive: true });
    }
    this.log.info(`Stockage local prêt (${this.root})`);
  }

  /**
   * Copie un fichier dans le dossier voulu. L'identifiant renvoyé est le nom du
   * fichier : il joue le rôle de l'ID Drive dans le reste de l'agent.
   */
  async upload(folder, path, { name, appProperties }) {
    const target = join(this.folders[folder], name);
    await copyFile(path, target);
    if (appProperties) {
      await writeFile(`${target}.json`, JSON.stringify(appProperties, null, 2));
    }
    const { size } = await stat(target);
    return { id: name, size };
  }

  async putContent(folder, name, buffer) {
    await writeFile(join(this.folders[folder], name), buffer);
    return name;
  }

  putJson(name, value) {
    return this.putContent("meta", name, Buffer.from(JSON.stringify(value, null, 2)));
  }

  putLiveSnapshot(jpeg) {
    return this.putContent("live", "live.jpg", jpeg);
  }

  async usage() {
    let count = 0;
    let bytes = 0;
    for (const name of await readdir(this.folders.clips)) {
      if (!name.endsWith(".mp4")) continue;
      count += 1;
      bytes += (await stat(join(this.folders.clips, name))).size;
    }
    return { count, bytes };
  }

  /** Même politique que Drive : clips purgés à 7 jours, résumés conservés un an. */
  async rotate(retentionDays, summaryRetentionDays) {
    const clipCutoff = Date.now() - retentionDays * 86_400_000;
    const metaCutoff = Date.now() - summaryRetentionDays * 86_400_000;
    let deleted = 0;

    for (const [folder, cutoff, keep] of [
      ["clips", clipCutoff, null],
      ["thumbs", clipCutoff, null],
      ["meta", metaCutoff, "status.json"],
    ]) {
      for (const name of await readdir(this.folders[folder])) {
        if (name === keep) continue;
        const path = join(this.folders[folder], name);
        try {
          if ((await stat(path)).mtimeMs < cutoff) {
            await unlink(path);
            deleted += 1;
          }
        } catch {
          /* déjà supprimé */
        }
      }
    }

    if (deleted > 0) this.log.info(`Rotation : ${deleted} fichiers supprimés localement`);
    return deleted;
  }

  /** Liste des clips avec leurs métadonnées, pour le visualiseur local. */
  async listClips() {
    const names = (await readdir(this.folders.clips)).filter((name) => name.endsWith(".mp4"));
    const clips = await Promise.all(
      names.map(async (name) => {
        let meta = {};
        try {
          meta = JSON.parse(await readFile(join(this.folders.clips, `${name}.json`), "utf8"));
        } catch {
          /* clip sans sidecar : on l'affiche quand même */
        }
        const { size, mtimeMs } = await stat(join(this.folders.clips, name));
        return {
          name,
          size,
          startedAt: new Date(Number(meta.t0) || mtimeMs).toISOString(),
          durationMs: Number(meta.dur ?? 0),
          motionScore: Number(meta.score ?? 0),
          zones: meta.z ?? "",
          thumb: meta.thumb ?? null,
        };
      }),
    );
    return clips.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}

/**
 * Construit le stockage adapté à la configuration : Drive si activé, disque
 * local sinon.
 */
export async function createStore({ config, logger }) {
  const store =
    config.storage.mode === "drive"
      ? new DriveStore({ config, logger })
      : new LocalStore({ config, logger });
  await store.init();
  return store;
}
