import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { join, normalize } from "node:path";

/**
 * Visualiseur local, volontairement minimal.
 *
 * Il sert le contenu du stockage local sur le réseau domestique : image en
 * quasi direct, liste des clips, lecture vidéo. C'est ce qui rend le mode sans
 * Drive utilisable au quotidien, le temps de valider l'installation.
 *
 * Il n'y a **aucune authentification** : à n'exposer que sur un réseau de
 * confiance, jamais derrière une redirection de port depuis Internet.
 */
export function startLocalServer({ store, config, logger, status }) {
  const root = config.storage.localDir;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://local");
    try {
      if (url.pathname === "/") return await sendPage(response);
      if (url.pathname === "/live.jpg") return await sendFile(response, join(root, "live", "live.jpg"), "image/jpeg", request);
      if (url.pathname === "/api/clips") return sendJson(response, await store.listClips());
      if (url.pathname === "/api/status") return sendJson(response, status());
      if (url.pathname === "/api/summary") {
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: config.behavior.timezone }).format(new Date());
        const raw = await readFile(join(root, "meta", `daily-${day}.json`), "utf8").catch(() => "null");
        return sendJson(response, JSON.parse(raw));
      }
      if (url.pathname.startsWith("/clips/")) {
        return await sendFile(response, safeJoin(root, "clips", url.pathname.slice(7)), "video/mp4", request);
      }
      if (url.pathname.startsWith("/thumbs/")) {
        return await sendFile(response, safeJoin(root, "thumbs", url.pathname.slice(8)), "image/jpeg", request);
      }
      response.writeHead(404).end("introuvable");
    } catch (error) {
      logger.debug(`serveur local: ${error.message}`);
      if (!response.headersSent) response.writeHead(404).end("introuvable");
    }
  });

  server.listen(config.storage.serverPort, () =>
    logger.info(`Visualiseur local sur http://<ip-de-cette-machine>:${config.storage.serverPort}`),
  );
  return server;
}

/** Empêche qu'un nom de fichier remonte hors du dossier servi. */
function safeJoin(root, folder, name) {
  const decoded = decodeURIComponent(name);
  if (normalize(decoded).includes("..")) throw new Error("chemin refusé");
  return join(root, folder, decoded);
}

function sendJson(response, value) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

/** Sert un fichier en gérant l'en-tête Range, nécessaire à la lecture vidéo. */
async function sendFile(response, path, mimeType, request) {
  const { size } = await stat(path);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");

  if (range && mimeType.startsWith("video/")) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    response.writeHead(206, {
      "content-type": mimeType,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
    });
    return createReadStream(path, { start, end }).pipe(response);
  }

  response.writeHead(200, {
    "content-type": mimeType,
    "content-length": size,
    "accept-ranges": "bytes",
    "cache-control": mimeType === "image/jpeg" ? "no-store" : "private, max-age=3600",
  });
  return createReadStream(path).pipe(response);
}

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Turtle Cam — local</title><style>
:root{--bg:#0b0f14;--panel:#151e2b;--line:#24334a;--text:#e7eef7;--muted:#8ea3bd;--accent:#3ddc97}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 20px 60px}
h1{font-size:22px;margin:20px 0 4px}p.sub{color:var(--muted);font-size:14px;margin:0 0 18px}
.live{background:#000;border-radius:14px;overflow:hidden;aspect-ratio:4/3;margin-bottom:20px}
.live img{width:100%;height:100%;object-fit:contain;display:block}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.pill{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:12.5px;color:var(--muted)}
.pill b{color:var(--text)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.clip{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.clip video{width:100%;display:block;background:#000;aspect-ratio:4/3}
.clip .m{padding:9px 11px;font-size:13px}.clip .m span{color:var(--muted);font-size:12px;display:block;margin-top:3px}
.empty{color:var(--muted);border:1px dashed var(--line);border-radius:14px;padding:26px;text-align:center;font-size:14px}
</style></head><body><main>
<h1>🐢 Turtle Cam — visualiseur local</h1>
<p class="sub">Stockage sur disque, sans Google Drive. Accessible uniquement sur ce réseau.</p>
<div class="live"><img id="live" alt="direct"></div>
<div class="row" id="status"></div>
<h2 style="font-size:16px">Enregistrements</h2>
<div id="clips" class="empty">Chargement…</div>
</main><script>
const live=document.getElementById('live');
setInterval(()=>{live.src='/live.jpg?t='+Date.now()},5000);live.src='/live.jpg';
const fmtDur=ms=>{const s=Math.round(ms/1000);return s>=60?Math.floor(s/60)+' min '+String(s%60).padStart(2,'0'):s+' s'};
const fmtSize=b=>b>1048576?(b/1048576).toFixed(1)+' Mo':Math.round(b/1024)+' Ko';
async function refresh(){
  try{
    const [status,clips,summary]=await Promise.all([
      fetch('/api/status').then(r=>r.json()),
      fetch('/api/clips').then(r=>r.json()),
      fetch('/api/summary').then(r=>r.json())]);
    document.getElementById('status').innerHTML=
      '<span class="pill">Caméra <b>'+(status.cameraOnline?'en ligne':'injoignable')+'</b></span>'+
      (status.recording?'<span class="pill">🔴 <b>Enregistrement</b></span>':'')+
      '<span class="pill">Dernier mouvement <b>'+(status.lastMotionAt?new Date(status.lastMotionAt).toLocaleTimeString('fr-FR'):'—')+'</b></span>'+
      '<span class="pill">Archive <b>'+status.clipCount+' clips</b></span>'+
      (summary?'<span class="pill">Repas <b>'+summary.meals+'</b></span><span class="pill">Sortie <b>'+
        (summary.wakeUpAt?new Date(summary.wakeUpAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—')+'</b></span>':'');
    const box=document.getElementById('clips');
    if(!clips.length){box.className='empty';box.textContent='Aucun enregistrement pour le moment.';return}
    box.className='grid';
    box.innerHTML=clips.map(c=>'<div class="clip"><video controls preload="metadata"'+
      (c.thumb?' poster="/thumbs/'+encodeURIComponent(c.thumb)+'"':'')+
      ' src="/clips/'+encodeURIComponent(c.name)+'"></video><div class="m">'+
      new Date(c.startedAt).toLocaleString('fr-FR')+'<span>'+fmtDur(c.durationMs)+' · '+fmtSize(c.size)+
      (c.zones?' · '+c.zones.replace(/\\|/g,' · '):'')+'</span></div></div>').join('');
  }catch(e){/* l'agent redémarre peut-être : on retentera au prochain tour */}
}
refresh();setInterval(refresh,15000);
</script></body></html>`;

async function sendPage(response) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(PAGE);
}
