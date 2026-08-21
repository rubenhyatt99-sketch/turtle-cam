#!/usr/bin/env node
import { unlink } from "node:fs/promises";
import { mjpegStream, rtspUrl, snapshot } from "./camera.js";
import { BehaviorTracker, localDay } from "./behavior.js";
import { VERSION, loadConfig, loadZones } from "./config.js";
import { DriveStore, encodeZones } from "./drive.js";
import { createLogger } from "./logger.js";
import { MotionDetector } from "./motion.js";
import { Recorder } from "./recorder.js";
import { buildMask, zoneAt } from "./zones.js";

/**
 * Agent local Turtle Cam.
 *
 * Boucle principale : le flux MJPEG basse résolution sert à la détection de
 * mouvement et au suivi de zone, pendant qu'ffmpeg enregistre le flux H.264 en
 * tampon circulaire. Chaque épisode de mouvement produit un clip qui part sur
 * Drive avec ses métadonnées, et alimente le résumé comportemental du jour.
 */

const log = createLogger(process.env.LOG_LEVEL ?? "info");

async function main() {
  const config = loadConfig();
  const { zones, mask } = loadZones();

  if (process.argv.includes("--check")) {
    process.exit((await runCheck(config, zones)) ? 0 : 1);
  }

  const drive = new DriveStore({ config, logger: log });
  await drive.init();

  const recorder = new Recorder({ config, rtsp: rtspUrl(config.camera), logger: log });
  recorder.start();

  const tracker = new BehaviorTracker({
    behavior: config.behavior,
    zones,
    day: localDay(Date.now(), config.behavior.timezone),
  });

  const detector = new MotionDetector({
    ...config.motion,
    mask: buildMask(mask, config.motion.width, config.motion.height),
  });

  const state = {
    recording: false,
    startedMs: 0,
    lastMotionMs: 0,
    scoreSum: 0,
    scoreCount: 0,
    zoneAccum: {},
    lastFrameMs: 0,
    cameraOnline: false,
    lastError: null,
    stream: null,
    usage: { count: 0, bytes: 0 },
    summaryDirty: true,
  };

  if (zones.length === 0) {
    log.warn("Aucune zone définie : les clips seront enregistrés, mais l’analyse v2 restera vide.");
  }

  /** Assemble, envoie et référence un clip couvrant l'épisode de mouvement. */
  async function finalizeClip(startedMs, endedMs, zoneAccum, score) {
    const clipStart = startedMs - config.recording.preRollSec * 1000;
    const clipEnd = endedMs + config.recording.postRollSec * 1000;

    if (!(await recorder.waitForCoverage(clipEnd))) {
      log.warn("Segments indisponibles pour cet épisode, clip abandonné.");
      return;
    }
    const built = await recorder.buildClip(clipStart, clipEnd);
    if (!built) return;

    let thumbId = null;
    let thumbPath = null;
    try {
      thumbPath = await recorder.thumbnail(built.path, built.durationMs);
      const uploaded = await drive.upload("thumbs", thumbPath, {
        name: `thumb-${clipStart}.jpg`,
        mimeType: "image/jpeg",
      });
      thumbId = uploaded.id;
    } catch (error) {
      log.warn(`vignette non générée : ${error.message}`);
    }

    const day = localDay(clipStart, config.behavior.timezone);
    const stamp = new Date(clipStart).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const uploaded = await drive.upload("clips", built.path, {
      name: `${stamp}.mp4`,
      mimeType: "video/mp4",
      appProperties: {
        kind: "clip",
        day,
        t0: String(clipStart),
        dur: String(Math.round(built.durationMs)),
        score: String(Math.round(score)),
        z: encodeZones(zoneAccum),
        ...(thumbId ? { thumb: thumbId } : {}),
      },
    });

    tracker.attachClip(uploaded.id, clipStart, clipEnd);
    state.summaryDirty = true;
    log.info(`Clip envoyé : ${stamp}.mp4 (${Math.round(built.durationMs / 1000)}s, mouvement ${Math.round(score)}%)`);

    await Promise.allSettled([unlink(built.path), thumbPath ? unlink(thumbPath) : Promise.resolve()]);
  }

  /** Traite une image du flux MJPEG. */
  async function onFrame(jpeg) {
    const now = Date.now();
    const result = await detector.analyze(jpeg);
    if (!result) return;

    const deltaSec = state.lastFrameMs ? Math.min((now - state.lastFrameMs) / 1000, 5) : 0;
    state.lastFrameMs = now;

    const moving = result.percent >= config.motion.triggerPercent;
    const zone = result.centroid ? zoneAt(result.centroid.x, result.centroid.y, zones) : null;
    tracker.observe(now, zone, moving);

    if (state.recording && zone) {
      state.zoneAccum[zone] = (state.zoneAccum[zone] ?? 0) + deltaSec;
    }

    if (moving) {
      state.lastMotionMs = now;
      state.scoreSum += result.percent;
      state.scoreCount += 1;
      if (!state.recording) {
        state.recording = true;
        state.startedMs = now;
        state.zoneAccum = {};
        state.scoreSum = result.percent;
        state.scoreCount = 1;
        log.debug(`Mouvement détecté (${result.percent.toFixed(2)}%)`);
      }
    }

    if (!state.recording) return;

    const quietSec = (now - state.lastMotionMs) / 1000;
    const lengthSec = (now - state.startedMs) / 1000;
    const finished =
      (result.percent < config.motion.clearPercent && quietSec >= config.recording.postRollSec) ||
      lengthSec >= config.recording.maxClipSec;

    if (finished) {
      const episode = {
        startedMs: state.startedMs,
        endedMs: state.lastMotionMs,
        zoneAccum: state.zoneAccum,
        score: state.scoreCount > 0 ? (state.scoreSum / state.scoreCount) * 10 : 0,
      };
      state.recording = false;
      state.zoneAccum = {};
      // L'assemblage attend la clôture d'un segment : on le laisse en tâche de
      // fond pour continuer à analyser le flux pendant ce temps.
      finalizeClip(episode.startedMs, episode.endedMs, episode.zoneAccum, Math.min(episode.score, 100)).catch(
        (error) => log.error(`clip non traité : ${error.message}`),
      );
    }
  }

  /** Connexion au flux MJPEG, avec reconnexion automatique. */
  function connectStream(delayMs = 2000) {
    const stream = mjpegStream(config.camera);
    state.stream = stream;
    let busy = false;

    stream.on("frame", (jpeg) => {
      state.cameraOnline = true;
      state.lastError = null;
      // Une image à la fois : si l'analyse prend du retard, on saute des images
      // plutôt que d'accumuler une file qui ferait dériver l'horodatage.
      if (busy) return;
      busy = true;
      onFrame(jpeg)
        .catch((error) => log.error(`analyse: ${error.message}`))
        .finally(() => {
          busy = false;
        });
    });

    stream.on("close", (error) => {
      state.cameraOnline = false;
      state.lastError = `caméra: ${error?.message ?? "flux interrompu"}`;
      detector.reset();
      log.warn(`${state.lastError} — reconnexion dans ${Math.round(delayMs / 1000)}s`);
      setTimeout(() => connectStream(Math.min(delayMs * 2, 60_000)), delayMs);
    });

    return stream;
  }

  connectStream();

  // --- Tâches périodiques -------------------------------------------------

  const timers = [];

  timers.push(
    setInterval(async () => {
      try {
        await drive.putLiveSnapshot(await snapshot(config.camera));
      } catch (error) {
        log.debug(`image live non publiée : ${error.message}`);
      }
    }, config.drive.snapshotIntervalSec * 1000),
  );

  timers.push(
    setInterval(async () => {
      try {
        const finished = tracker.rolloverIfNeeded(Date.now());
        if (finished) {
          await drive.putJson(`daily-${finished.day}.json`, finished, { kind: "daily", day: finished.day });
          log.info(`Journée ${finished.day} clôturée : ${finished.events.length} événements`);
        }
        if (state.summaryDirty || !finished) {
          const summary = tracker.serialize();
          await drive.putJson(`daily-${summary.day}.json`, summary, { kind: "daily", day: summary.day });
          state.summaryDirty = false;
        }
      } catch (error) {
        log.warn(`résumé non publié : ${error.message}`);
      }
    }, 60_000),
  );

  timers.push(
    setInterval(async () => {
      try {
        await drive.putJson("status.json", {
          updatedAt: new Date().toISOString(),
          cameraOnline: state.cameraOnline,
          recording: state.recording,
          lastMotionAt: state.lastMotionMs ? new Date(state.lastMotionMs).toISOString() : null,
          version: VERSION,
          storageBytes: state.usage.bytes,
          clipCount: state.usage.count,
          error: state.lastError,
        });
      } catch (error) {
        log.warn(`statut non publié : ${error.message}`);
      }
    }, config.drive.statusIntervalSec * 1000),
  );

  timers.push(
    setInterval(() => {
      recorder.pruneSegments();
      recorder.pruneClips();
    }, 60_000),
  );

  const rotate = async () => {
    try {
      await drive.rotate(config.drive.retentionDays, config.drive.summaryRetentionDays);
      state.usage = await drive.usage();
    } catch (error) {
      log.warn(`rotation impossible : ${error.message}`);
    }
  };
  timers.push(setInterval(rotate, 3600_000));
  await rotate();

  log.info(`Agent Turtle Cam ${VERSION} démarré (caméra ${config.camera.host})`);

  const shutdown = async () => {
    log.info("Arrêt en cours…");
    for (const timer of timers) clearInterval(timer);
    state.stream?.stop?.();
    recorder.stop();
    try {
      await drive.putJson(`daily-${tracker.summary.day}.json`, tracker.serialize(), { kind: "daily" });
    } catch {
      /* l'agent s'arrête : on ne bloque pas sur Drive */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Vérifie la configuration et les accès sans rien enregistrer. */
async function runCheck(config, zones) {
  const results = [];
  const { spawnSync } = await import("node:child_process");

  const ffmpeg = spawnSync(config.recording.ffmpegPath, ["-version"], { encoding: "utf8" });
  results.push([
    "ffmpeg",
    ffmpeg.status === 0,
    ffmpeg.status === 0 ? ffmpeg.stdout.split("\n")[0] : "introuvable dans le PATH",
  ]);

  try {
    const jpeg = await snapshot(config.camera);
    results.push(["caméra (snapshot)", jpeg.length > 1000, `${Math.round(jpeg.length / 1024)} Ko reçus`]);
  } catch (error) {
    results.push(["caméra (snapshot)", false, error.message]);
  }

  try {
    const drive = new DriveStore({ config, logger: { info() {}, warn() {}, error() {} } });
    await drive.init();
    const usage = await drive.usage();
    results.push(["Google Drive", true, `${usage.count} clips déjà stockés`]);
  } catch (error) {
    results.push(["Google Drive", false, error.message]);
  }

  results.push(["zones", zones.length > 0, `${zones.length} zone(s) définie(s)`]);

  let ok = true;
  for (const [name, passed, detail] of results) {
    if (!passed && name !== "zones") ok = false;
    console.log(`${passed ? "✅" : "❌"} ${name.padEnd(20)} ${detail}`);
  }
  return ok;
}

main().catch((error) => {
  log.error(error.stack ?? error.message);
  process.exit(1);
});
