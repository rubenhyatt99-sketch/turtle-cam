import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * Accès à la caméra AXIS : authentification Digest (celle activée par défaut
 * sur les AXIS, avec repli sur Basic), flux MJPEG et capture d'image unique.
 */

const md5 = (value) => crypto.createHash("md5").update(value).digest("hex");

function parseChallenge(header) {
  const params = {};
  for (const match of header.matchAll(/(\w+)=("([^"]*)"|[^,\s]*)/g)) {
    params[match[1]] = match[3] ?? match[2];
  }
  return params;
}

function digestHeader(challenge, { username, password, method, uri }) {
  const params = parseChallenge(challenge);
  const cnonce = crypto.randomBytes(8).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${username}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = params.qop?.split(",")[0]?.trim();
  const response = qop
    ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${params.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${params.realm}"`,
    `nonce="${params.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (params.opaque) parts.push(`opaque="${params.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(", ")}`;
}

/**
 * Effectue une requête GET authentifiée et renvoie la réponse HTTP en flux.
 * La première tentative est anonyme : le challenge renvoyé par la caméra
 * détermine ensuite le schéma d'authentification utilisé.
 */
export function request(camera, path, { timeoutMs = 15000 } = {}) {
  const transport = camera.protocol === "https" ? https : http;
  const url = new URL(`${camera.protocol}://${camera.host}${path}`);
  const uri = url.pathname + url.search;

  const send = (headers) =>
    new Promise((resolvePromise, rejectPromise) => {
      const req = transport.get(
        { hostname: url.hostname, port: url.port || undefined, path: uri, headers },
        resolvePromise,
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout caméra")));
      req.on("error", rejectPromise);
    });

  return send({}).then((res) => {
    if (res.statusCode !== 401) return res;
    const challenge = res.headers["www-authenticate"] ?? "";
    res.resume(); // libère la connexion avant de rejouer la requête
    const authorization = challenge.toLowerCase().startsWith("digest")
      ? digestHeader(challenge, {
          username: camera.username,
          password: camera.password,
          method: "GET",
          uri,
        })
      : `Basic ${Buffer.from(`${camera.username}:${camera.password}`).toString("base64")}`;
    return send({ Authorization: authorization });
  });
}

/** Capture une image JPEG unique. */
export async function snapshot(camera) {
  const res = await request(camera, camera.snapshotPath ?? "/axis-cgi/jpg/image.cgi");
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`snapshot HTTP ${res.statusCode}`);
  }
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Flux MJPEG découpé en images JPEG complètes.
 *
 * Émet `frame` (Buffer JPEG), `error` et `close`. Les marqueurs SOI (FFD8) et
 * EOI (FFD9) sont recherchés directement dans le flux : c'est plus tolérant
 * que de se fier aux frontières multipart, que certains firmwares tronquent.
 */
export function mjpegStream(camera) {
  const emitter = new EventEmitter();
  let stopped = false;
  let response = null;

  (async () => {
    try {
      response = await request(camera, camera.mjpegPath ?? "/axis-cgi/mjpg/video.cgi", { timeoutMs: 20000 });
      if (response.statusCode !== 200) {
        response.resume();
        throw new Error(`flux MJPEG HTTP ${response.statusCode}`);
      }

      const SOI = Buffer.from([0xff, 0xd8]);
      const EOI = Buffer.from([0xff, 0xd9]);
      let buffer = Buffer.alloc(0);
      response.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const start = buffer.indexOf(SOI);
          if (start < 0) {
            // Rien d'exploitable : on évite de laisser grossir le tampon.
            if (buffer.length > 2_000_000) buffer = Buffer.alloc(0);
            return;
          }
          const end = buffer.indexOf(EOI, start + 2);
          if (end < 0) return;
          emitter.emit("frame", buffer.subarray(start, end + 2));
          buffer = buffer.subarray(end + 2);
        }
      });
      response.on("end", () => !stopped && emitter.emit("close", new Error("flux terminé")));
      response.on("error", (error) => !stopped && emitter.emit("close", error));
    } catch (error) {
      if (!stopped) emitter.emit("close", error);
    }
  })();

  emitter.stop = () => {
    stopped = true;
    response?.destroy();
  };
  return emitter;
}

/** URL RTSP utilisée par ffmpeg pour l'enregistrement H.264. */
export function rtspUrl(camera) {
  const credentials = `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}`;
  const path = camera.rtspPath ?? "/axis-media/media.amp";
  return `rtsp://${credentials}@${camera.host}:${camera.rtspPort ?? 554}${path}`;
}
