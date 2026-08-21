/** Types partagés entre l'agent local et le portail. */

/** Un clip vidéo enregistré suite à une détection de mouvement. */
export type Clip = {
  /** Identifiant Google Drive du fichier MP4. */
  id: string;
  name: string;
  /** Début de l'enregistrement (ISO 8601, inclut le pre-roll). */
  startedAt: string;
  durationMs: number;
  sizeBytes: number;
  /** Jour local (YYYY-MM-DD) utilisé pour les regroupements. */
  day: string;
  /** Intensité moyenne du mouvement, 0-100. */
  motionScore: number;
  /** Temps passé par zone pendant le clip, en secondes. */
  zoneSeconds: Record<string, number>;
  /** Identifiant Drive de la vignette JPEG, si elle existe. */
  thumbId: string | null;
};

/** Type d'événement de comportement détecté par l'agent (v2). */
export type BehaviorKind =
  | "sortie_maison"
  | "retour_maison"
  | "repas"
  | "bain"
  | "bronzage"
  | "reveil"
  | "coucher";

export type BehaviorEvent = {
  kind: BehaviorKind;
  /** Début de l'événement (ISO 8601). */
  at: string;
  /** Durée en secondes (0 pour les événements ponctuels). */
  durationSec: number;
  /** Zone concernée, si applicable. */
  zone?: string;
  /** Confiance 0-1 calculée par l'agent. */
  confidence: number;
  /** Clip Drive qui contient l'événement, si disponible. */
  clipId?: string;
};

/** Résumé quotidien produit par l'agent et stocké dans Drive. */
export type DailySummary = {
  day: string;
  /** Première et dernière activité détectée dans la journée. */
  firstMotionAt: string | null;
  lastMotionAt: string | null;
  /** Heure de sortie de la maison la plus matinale. */
  wakeUpAt: string | null;
  /** Heure du dernier retour dans la maison. */
  bedTimeAt: string | null;
  /** Nombre de repas détectés. */
  meals: number;
  /** Horaires des repas (ISO 8601). */
  mealTimes: string[];
  /** Secondes passées dans chaque zone. */
  zoneSeconds: Record<string, number>;
  /** Secondes de mouvement cumulées (proxy d'activité). */
  activeSeconds: number;
  /** Nombre de clips enregistrés. */
  clips: number;
  events: BehaviorEvent[];
};

/** État de santé de l'agent, réécrit régulièrement dans Drive. */
export type AgentStatus = {
  updatedAt: string;
  cameraOnline: boolean;
  recording: boolean;
  /** Dernière détection de mouvement (ISO 8601). */
  lastMotionAt: string | null;
  version: string;
  /** Espace occupé sur Drive par les clips, en octets. */
  storageBytes: number;
  clipCount: number;
  /** Message d'erreur courant, le cas échéant. */
  error: string | null;
};
