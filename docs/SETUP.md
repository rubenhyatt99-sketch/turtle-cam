# Installation

Trois étapes : la caméra, Google Drive, puis les deux composants logiciels
(l'agent chez vous, le portail sur Vercel).

---

## 1. Caméra AXIS M1031-W

Dans l'interface web de la caméra (`http://<ip-camera>/`) :

1. **Utilisateur dédié** — *Setup → System Options → Security → Users* : créez un
   compte `turtlecam` avec le rôle *Viewer* et l'accès **anonyme désactivé**.
2. **IP fixe** — *System Options → Network → TCP/IP*, ou une réservation DHCP sur
   la box, pour que l'adresse ne change pas.
3. **Heure** — *System Options → Date & Time* : NTP activé, fuseau correct. Les
   horodatages des clips en dépendent.
4. **Flux** — la M1031-W expose :
   * MJPEG : `http://<ip>/axis-cgi/mjpg/video.cgi?resolution=320x240&fps=5`
   * Image fixe : `http://<ip>/axis-cgi/jpg/image.cgi?resolution=640x480`
   * RTSP/H.264 : `rtsp://<ip>:554/axis-media/media.amp?videocodec=h264&resolution=640x480`

   Vérifiez que le codec H.264 est activé (*Video & Audio → Video Stream → H.264*).
   Si votre firmware ne fournit que du MJPEG, remplacez dans `config.json` le
   `rtspPath` par le chemin MJPEG et laissez ffmpeg réencoder — le CPU montera un
   peu, tout le reste fonctionne à l'identique.

> La détection de mouvement intégrée à la caméra n'est pas utilisée : l'agent
> fait la sienne, ce qui permet le suivi par zone nécessaire à l'analyse v2.

---

## 2. Google Drive — *optionnel au début*

> **Vous pouvez sauter cette étape.** L'agent démarre en mode `local` : il
> enregistre sur le disque de la machine et expose un visualiseur sur votre
> réseau. C'est la bonne façon de valider caméra, détection et zones avant
> d'ajouter le cloud. Passez directement à l'étape 3, et revenez ici quand vous
> voudrez consulter la tortue depuis l'extérieur.
> Détails : [« Démarrer sans Google Drive »](#démarrer-sans-google-drive).


1. Sur [console.cloud.google.com](https://console.cloud.google.com) : créez un
   projet, puis activez **Google Drive API**.
2. *IAM & Admin → Service Accounts* : créez un compte de service, puis
   *Keys → Add key → JSON*. Téléchargez le fichier.
3. Dans votre Drive personnel, créez un dossier `TurtleCam`. Partagez-le avec
   l'adresse e-mail du compte de service (`…@….iam.gserviceaccount.com`) en
   **Éditeur**.
4. Relevez l'ID du dossier : il est dans l'URL,
   `https://drive.google.com/drive/folders/`**`1AbC…`**.

Les sous-dossiers `clips/`, `thumbs/`, `meta/` et `live/` sont créés
automatiquement au premier démarrage de l'agent.

> Le quota Drive gratuit (15 Go) tient largement une semaine de clips en
> 640x480 : comptez ~2 à 4 Mo par minute enregistrée, et seules les périodes
> de mouvement sont conservées.

---

## 3. Agent local

L'agent doit tourner en permanence sur une machine du même réseau que la
caméra : Raspberry Pi, NAS, mini-PC, vieux portable — tout fait l'affaire.

```bash
sudo apt install -y nodejs npm ffmpeg      # Node 20+ et ffmpeg requis
git clone <votre-repo> /opt/turtle-cam
cd /opt/turtle-cam/agent
npm install

cp config.example.json config.json
cp zones.example.json  zones.json
cp ~/Téléchargements/service-account.json ./service-account.json
```

Éditez `config.json` : `camera.host`, `camera.username`, `camera.password`.
En mode `local` (le défaut) il n'y a rien d'autre à renseigner. Puis vérifiez
que tout répond :

```bash
npm run check
```

```
✅ ffmpeg               ffmpeg version 6.1.1
✅ caméra (snapshot)    38 Ko reçus
✅ stockage local       0 clips déjà stockés
✅ zones                4 zone(s) définie(s)
```

Démarrage :

```bash
npm start                      # en avant-plan, pour observer les logs
sudo cp turtle-cam-agent.service /etc/systemd/system/
sudo systemctl enable --now turtle-cam-agent    # puis en service
journalctl -u turtle-cam-agent -f
```

### Démarrer sans Google Drive

C'est le mode par défaut, réglé dans `config.json` :

```json
"storage": {
  "mode": "local",
  "localDir": "./data",
  "serverEnabled": true,
  "serverPort": 8080
}
```

L'agent écrit alors dans `agent/data/` — clips, vignettes, résumés quotidiens,
image live — avec la **même rotation à 7 jours** qu'avec Drive, et sert un
visualiseur sur `http://<ip-de-la-machine>:8080` : image en quasi direct, liste
des clips, lecture vidéo, repas et heure de sortie du jour.

⚠️ Ce visualiseur **n'a aucune authentification**. Il est prévu pour un réseau
domestique. Ne le rendez pas accessible depuis Internet par une redirection de
port : pour un accès extérieur, c'est le portail Vercel qu'il faut utiliser,
avec son mot de passe.

Pour basculer sur Drive plus tard, il suffit de renseigner l'étape 2 puis :

```json
"storage": { "mode": "drive" }
```

Les clips déjà présents dans `agent/data/` ne sont pas transférés — seuls les
nouveaux partent sur Drive.

### Régler les zones

`zones.json` décrit l'enclos en coordonnées **normalisées** : `0,0` est le coin
haut-gauche de l'image, `1,1` le coin bas-droit.

1. Ouvrez `http://<ip-camera>/axis-cgi/jpg/image.cgi` dans un navigateur.
2. Ouvrez l'image dans n'importe quel éditeur affichant les coordonnées du
   curseur (Aperçu, GIMP, Paint…).
3. Pour chaque zone, relevez les coins et divisez par la largeur / hauteur de
   l'image. Un rectangle de 4 points suffit.
4. `mask` accepte les mêmes polygones : tout ce qui s'y trouve est **ignoré**
   par la détection (reflets sur l'eau, fenêtre, plante qui bouge).

Les noms utilisés par l'analyse sont ceux de `behavior` dans `config.json`
(`maison`, `gamelle`, `bassin`, `lampe` par défaut) — renommez-les si votre
terrarium est organisé autrement.

### Régler la sensibilité

| Symptôme | Réglage |
| --- | --- |
| Trop de clips sans rien dessus | augmenter `motion.triggerPercent` (1.2 → 2.5) |
| Mouvements lents non détectés | baisser `motion.pixelThreshold` (18 → 12) |
| Clips coupés trop tôt | augmenter `recording.postRollSec` |
| Disque local saturé | baisser `recording.ringMinutes` |

---

## 4. Portail sur Vercel

L'application Next.js est à la racine du dépôt : **laissez le champ « Root
Directory » vide** dans Vercel. C'est le réglage qui pose le plus souvent
problème, il n'y a ici rien à y mettre.

Le plus simple est d'importer le dépôt depuis *vercel.com → Add New… →
Project*, ce qui donne en prime le redéploiement automatique à chaque `git
push`. En ligne de commande :

```bash
npm install
npx vercel            # première fois : lie le projet
npx vercel --prod
```

Variables d'environnement à définir dans *Vercel → Project → Settings →
Environment Variables* (voir `.env.example`) :

| Variable | Valeur |
| --- | --- |
| `PORTAL_USERS` | `ruben:$2b$12$…` — voir ci-dessous |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `GOOGLE_SERVICE_ACCOUNT_B64` | `base64 -w0 service-account.json` |
| `DRIVE_ROOT_FOLDER_ID` | même ID que l'agent |
| `TIMEZONE` | `Europe/Paris` |

Le mot de passe n'est jamais stocké en clair — générez son empreinte :

```bash
cd agent && node scripts/hash-password.mjs 'mon-mot-de-passe'
# $2b$12$K8… → à coller dans PORTAL_USERS sous la forme ruben:$2b$12$K8…
```

Plusieurs comptes : séparez-les par des virgules
(`ruben:$2b$12$…,marie:$2b$12$…`).

Le portail utilise un compte de service **en lecture seule** sur Drive : même
compromis, il ne peut rien supprimer.

---

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « Aucun signal de l'agent local » | l'agent ne tourne pas, ou `DRIVE_ROOT_FOLDER_ID` diffère entre l'agent et Vercel |
| Pas d'image en direct | `snapshotPath` incorrect, ou compte caméra sans droit de capture |
| `ffmpeg arrêté (code 1)` en boucle | mauvais `rtspPath`, ou H.264 désactivé sur la caméra |
| Clips vides / abandonnés | `recording.ringMinutes` trop court par rapport à `maxClipSec` |
| `No Next.js version detected` au build | un « Root Directory » est configuré dans Vercel : videz le champ |
| Timeline vide alors que Drive se remplit | vérifier que le dossier racine est bien partagé avec **les deux** comptes de service |
| Analyse v2 vide | `zones.json` absent ou polygones hors cadre |
| Visualiseur local injoignable | `serverEnabled` à `false`, ou pare-feu sur le port 8080 |
