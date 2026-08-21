import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = resolve(here, "..");
export const VERSION = "1.0.0";

const DEFAULTS = {
  camera: { protocol: "http", rtspPort: 554 },
  recording: {
    segmentSec: 15,
    ringMinutes: 10,
    preRollSec: 6,
    postRollSec: 8,
    minClipSec: 8,
    maxClipSec: 180,
    workDir: "./recordings",
    ffmpegPath: "ffmpeg",
  },
  motion: {
    width: 160,
    height: 120,
    pixelThreshold: 18,
    triggerPercent: 1.2,
    clearPercent: 0.5,
    warmupFrames: 20,
    ignoreNightVisionSwitch: true,
  },
  drive: {
    retentionDays: 7,
    summaryRetentionDays: 365,
    snapshotIntervalSec: 10,
    statusIntervalSec: 60,
    serviceAccountFile: "./service-account.json",
  },
  behavior: {
    timezone: "Europe/Paris",
    homeZone: "maison",
    foodZone: "gamelle",
    waterZone: "bassin",
    baskZone: "lampe",
    zoneDebounceSec: 4,
    minOutingSec: 45,
    minReturnSec: 120,
    mealMinSec: 60,
    mealCooldownSec: 1800,
    bathMinSec: 90,
    baskMinSec: 300,
  },
};

function merge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value) ? merge(base[key] ?? {}, value) : value;
  }
  return result;
}

/** Résout un chemin relatif par rapport à la racine de l'agent. */
export function agentPath(value) {
  return isAbsolute(value) ? value : resolve(AGENT_ROOT, value);
}

/**
 * Charge `config.json` (ou le fichier passé via `--config`) et applique les
 * valeurs par défaut. Les secrets peuvent aussi venir de l'environnement, ce
 * qui évite de les écrire dans le fichier : CAMERA_PASSWORD, DRIVE_ROOT_FOLDER_ID.
 */
export function loadConfig(argv = process.argv) {
  const flagIndex = argv.indexOf("--config");
  const file = agentPath(flagIndex >= 0 ? argv[flagIndex + 1] : "config.json");
  if (!existsSync(file)) {
    throw new Error(`Configuration introuvable : ${file}\nCopiez config.example.json vers config.json.`);
  }

  const config = merge(DEFAULTS, JSON.parse(readFileSync(file, "utf8")));
  config.camera.password = process.env.CAMERA_PASSWORD || config.camera.password;
  config.drive.rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID || config.drive.rootFolderId;

  const missing = [];
  if (!config.camera?.host) missing.push("camera.host");
  if (!config.camera?.username) missing.push("camera.username");
  if (!config.camera?.password) missing.push("camera.password");
  if (!config.drive?.rootFolderId || config.drive.rootFolderId.startsWith("REMPLACER")) {
    missing.push("drive.rootFolderId");
  }
  if (missing.length > 0) {
    throw new Error(`Configuration incomplète : ${missing.join(", ")}`);
  }

  config.recording.workDir = agentPath(config.recording.workDir);
  config.drive.serviceAccountFile = agentPath(config.drive.serviceAccountFile);
  config.stateDir = agentPath(config.stateDir ?? "./state");
  return config;
}

/** Charge les zones. Absentes, l'agent fonctionne mais sans analyse v2. */
export function loadZones(argv = process.argv) {
  const flagIndex = argv.indexOf("--zones");
  const file = agentPath(flagIndex >= 0 ? argv[flagIndex + 1] : "zones.json");
  if (!existsSync(file)) return { zones: [], mask: [] };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return { zones: parsed.zones ?? [], mask: parsed.mask ?? [] };
}
