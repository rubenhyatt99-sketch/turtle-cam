# Turtle Cam — portail de surveillance (AXIS M1031-W)

Portail type "Surveillance Station" pour une caméra AXIS M1031-W, avec détection
de mouvement, enregistrement par clips, stockage Google Drive, rotation 7 jours,
et analyse comportementale de la tortue (v2).

## Architecture

La caméra AXIS est sur le réseau local. Vercel est un runtime serverless : ses
fonctions durent quelques dizaines de secondes et n'ont aucun accès au LAN. Il
est donc **impossible** de faire tourner l'enregistrement continu et la détection
de mouvement sur Vercel. L'architecture est donc en deux morceaux :

```
  ┌────────────────────┐        ┌──────────────────────┐        ┌─────────────────┐
  │ AXIS M1031-W (LAN) │ MJPEG  │  agent/  (Raspberry  │  API   │  Google Drive   │
  │ 192.168.x.x        │───────▶│  Pi, NAS, PC…)       │───────▶│  clips + méta   │
  └────────────────────┘  RTSP  │  motion + ffmpeg     │        └────────┬────────┘
                                │  analyse tortue      │                 │ lecture
                                └──────────────────────┘                 │ (service account)
                                                                ┌────────▼────────┐
                                                                │  web/  (Vercel) │
                                                                │  login + portail│
                                                                └─────────────────┘
```

* **`agent/`** — process Node.js qui tourne 24/7 chez vous. Il lit le flux de la
  caméra, détecte le mouvement, enregistre des clips MP4 (ffmpeg), les envoie sur
  Google Drive avec leurs métadonnées, purge ce qui a plus de 7 jours, pousse une
  image "live" toutes les N secondes, et calcule les événements de comportement.
* **`web/`** — application Next.js déployée sur Vercel. Login / mot de passe,
  timeline des clips, lecture vidéo (proxy Drive avec support du Range), vue
  quasi-live, et tableau de bord comportemental.

Google Drive est l'unique source de vérité : **pas de base de données à gérer**.

## Démarrage

* Installation complète et pas-à-pas : [`docs/SETUP.md`](docs/SETUP.md)
* Détail de l'analyse comportementale : [`docs/BEHAVIOR.md`](docs/BEHAVIOR.md)
