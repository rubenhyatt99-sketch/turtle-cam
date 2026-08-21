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
                                                                │ portail (Vercel)│
                                                                │  login + portail│
                                                                └─────────────────┘
```

* **`agent/`** — process Node.js qui tourne 24/7 chez vous. Il lit le flux de la
  caméra, détecte le mouvement, enregistre des clips MP4 (ffmpeg), les envoie sur
  Google Drive avec leurs métadonnées, purge ce qui a plus de 7 jours, pousse une
  image "live" toutes les N secondes, et calcule les événements de comportement.
* **racine du repo** — application Next.js déployée sur Vercel. Login / mot de passe,
  timeline des clips, lecture vidéo (proxy Drive avec support du Range), vue
  quasi-live, et tableau de bord comportemental.

Google Drive est l'unique source de vérité : **pas de base de données à gérer**.

L'agent sait aussi tourner **sans Drive** (`storage.mode: "local"`, le défaut) :
il enregistre sur son propre disque et expose un visualiseur sur le réseau
local. Pratique pour valider l'installation avant d'ajouter le cloud — le
portail Vercel, lui, a besoin de Drive pour avoir quelque chose à afficher.

L'application Next.js vit à la racine du dépôt, et non dans un sous-dossier :
Vercel la détecte ainsi sans qu'aucun « Root Directory » ne soit à configurer.

## Démarrage

* Installation complète et pas-à-pas : [`docs/SETUP.md`](docs/SETUP.md)
* Détail de l'analyse comportementale : [`docs/BEHAVIOR.md`](docs/BEHAVIOR.md)
