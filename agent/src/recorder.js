import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Enregistrement en tampon circulaire.
 *
 * ffmpeg écrit en continu des segments courts (H.264 copié tel quel, donc
 * quasiment sans CPU). Quand un mouvement est détecté, le clip est reconstruit
 * à partir des segments qui couvrent la fenêtre voulue : on récupère ainsi un
 * pré-enregistrement réel avant le déclenchement, impossible à obtenir en
 * démarrant ffmpeg au moment de la détection.
 */
export class Recorder {
  constructor({ config, rtsp, logger }) {
    this.config = config.recording;
    this.rtsp = rtsp;
    this.log = logger;
    this.segmentDir = join(this.config.workDir, "segments");
    this.clipDir = join(this.config.workDir, "clips");
    mkdirSync(this.segmentDir, { recursive: true });
    mkdirSync(this.clipDir, { recursive: true });
    this.process = null;
    this.stopped = false;
    this.restartDelayMs = 2000;
    this.online = false;
  }

  start() {
    if (this.stopped) return;
    const pattern = join(this.segmentDir, "seg-%Y%m%d-%H%M%S.mp4");
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-rtsp_transport", "tcp",
      "-use_wallclock_as_timestamps", "1",
      "-i", this.rtsp,
      "-an",
      "-c:v", "copy",
      "-f", "segment",
      "-segment_time", String(this.config.segmentSec),
      "-segment_format", "mp4",
      "-segment_format_options", "movflags=+faststart",
      "-reset_timestamps", "1",
      "-strftime", "1",
      pattern,
    ];

    this.process = spawn(this.config.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    this.online = true;
    this.process.stderr.on("data", (chunk) => this.log.warn(`ffmpeg: ${String(chunk).trim()}`));
    this.process.on("exit", (code) => {
      this.online = false;
      this.process = null;
      if (this.stopped) return;
      this.log.warn(`ffmpeg arrêté (code ${code}), relance dans ${this.restartDelayMs / 1000}s`);
      setTimeout(() => this.start(), this.restartDelayMs);
      // Backoff plafonné : une caméra débranchée ne doit pas saturer les logs.
      this.restartDelayMs = Math.min(this.restartDelayMs * 2, 60_000);
    });
    // Un segment complet écrit sans erreur signifie que le flux est sain.
    setTimeout(() => {
      if (this.process) this.restartDelayMs = 2000;
    }, this.config.segmentSec * 2000);
  }

  stop() {
    this.stopped = true;
    this.process?.kill("SIGTERM");
  }

  /** Segments présents sur disque, triés par heure de début croissante. */
  #segments() {
    return readdirSync(this.segmentDir)
      .filter((name) => /^seg-\d{8}-\d{6}\.mp4$/.test(name))
      .map((name) => {
        const [, date, time] = name.match(/^seg-(\d{8})-(\d{6})\.mp4$/);
        const startedAt = new Date(
          Number(date.slice(0, 4)),
          Number(date.slice(4, 6)) - 1,
          Number(date.slice(6, 8)),
          Number(time.slice(0, 2)),
          Number(time.slice(2, 4)),
          Number(time.slice(4, 6)),
        ).getTime();
        return { name, path: join(this.segmentDir, name), startedAt };
      })
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * Attend que le segment couvrant `untilMs` soit clos par ffmpeg : un segment
   * encore en cours d'écriture n'a pas d'index MP4 exploitable.
   */
  async waitForCoverage(untilMs) {
    const deadline = Date.now() + (this.config.segmentSec * 2 + 10) * 1000;
    for (;;) {
      const segments = this.#segments();
      const last = segments.at(-1);
      if (last && last.startedAt > untilMs) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }

  /**
   * Assemble un clip couvrant [startMs, endMs] et renvoie son chemin, ou `null`
   * si aucun segment ne couvre la fenêtre.
   */
  async buildClip(startMs, endMs) {
    const segments = this.#segments();
    if (segments.length === 0) return null;

    // Le dernier segment est potentiellement encore ouvert : on l'exclut.
    const usable = segments.slice(0, -1);
    const covering = usable.filter((segment, index) => {
      const next = usable[index + 1];
      const segmentEnd = next ? next.startedAt : segment.startedAt + this.config.segmentSec * 1000;
      return segment.startedAt < endMs && segmentEnd > startMs;
    });
    if (covering.length === 0) return null;

    const listPath = join(this.clipDir, `concat-${startMs}.txt`);
    writeFileSync(listPath, covering.map((segment) => `file '${segment.path}'`).join("\n"));

    const offsetSec = Math.max((startMs - covering[0].startedAt) / 1000, 0);
    const durationSec = Math.min(
      Math.max((endMs - startMs) / 1000, this.config.minClipSec),
      this.config.maxClipSec,
    );
    const output = join(this.clipDir, `clip-${startMs}.mp4`);

    try {
      await this.#run([
        "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", listPath,
        "-ss", offsetSec.toFixed(2),
        "-t", durationSec.toFixed(2),
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", output,
      ]);
      return { path: output, durationMs: durationSec * 1000 };
    } catch (error) {
      this.log.error(`assemblage du clip impossible: ${error.message}`);
      return null;
    } finally {
      try {
        unlinkSync(listPath);
      } catch {
        /* le fichier de liste est temporaire, son absence est sans conséquence */
      }
    }
  }

  /** Extrait une vignette JPEG du clip. */
  async thumbnail(clipPath, durationMs) {
    const output = clipPath.replace(/\.mp4$/, ".jpg");
    const seek = Math.min(2, durationMs / 2000);
    await this.#run([
      "-hide_banner", "-loglevel", "error",
      "-ss", seek.toFixed(2),
      "-i", clipPath,
      "-frames:v", "1",
      "-vf", "scale=480:-2",
      "-q:v", "5",
      "-y", output,
    ]);
    return output;
  }

  /** Supprime les segments sortis de la fenêtre du tampon circulaire. */
  pruneSegments() {
    const cutoff = Date.now() - this.config.ringMinutes * 60_000;
    for (const segment of this.#segments().slice(0, -1)) {
      if (segment.startedAt < cutoff) {
        try {
          unlinkSync(segment.path);
        } catch {
          /* déjà supprimé */
        }
      }
    }
  }

  /** Supprime les clips locaux déjà envoyés (ou trop vieux) pour libérer le disque. */
  pruneClips(maxAgeMinutes = 60) {
    const cutoff = Date.now() - maxAgeMinutes * 60_000;
    for (const name of readdirSync(this.clipDir)) {
      const path = join(this.clipDir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        /* concurrent avec l'upload, sans gravité */
      }
    }
  }

  #run(args) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(this.config.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", rejectPromise);
      child.on("exit", (code) =>
        code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim() || `ffmpeg code ${code}`)),
      );
    });
  }
}
