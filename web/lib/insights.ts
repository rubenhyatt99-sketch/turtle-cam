import { timeZone } from "./format";
import type { DailySummary } from "./types";

/**
 * Analyse d'habitudes (v2) : à partir des résumés quotidiens produits par
 * l'agent, on dérive un profil moyen puis on compare la journée en cours pour
 * signaler ce qui sort de l'ordinaire.
 */

/** Minutes écoulées depuis minuit, dans le fuseau configuré. */
export function minutesOfDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const hour = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function average(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export type Habits = {
  /** Nombre de journées utilisées comme référence. */
  sampleDays: number;
  wakeUpAvgMin: number | null;
  bedTimeAvgMin: number | null;
  mealsAvg: number | null;
  activeSecAvg: number | null;
  /** Heures de repas moyennes, groupées en créneaux matin / après-midi. */
  mealSlots: { label: string; avgMin: number; count: number }[];
  /** Secondes moyennes par zone et par jour. */
  zoneAvgSeconds: Record<string, number>;
};

export function computeHabits(baseline: DailySummary[]): Habits {
  const zoneTotals: Record<string, number> = {};
  for (const day of baseline) {
    for (const [zone, seconds] of Object.entries(day.zoneSeconds ?? {})) {
      zoneTotals[zone] = (zoneTotals[zone] ?? 0) + seconds;
    }
  }
  const zoneAvgSeconds: Record<string, number> = {};
  for (const [zone, total] of Object.entries(zoneTotals)) {
    zoneAvgSeconds[zone] = baseline.length > 0 ? total / baseline.length : 0;
  }

  // Les repas sont regroupés par créneau de 3 h pour faire ressortir un rythme
  // (par ex. « vers 9 h » et « vers 17 h ») plutôt qu'une moyenne unique.
  const buckets = new Map<number, number[]>();
  for (const day of baseline) {
    for (const at of day.mealTimes ?? []) {
      const minutes = minutesOfDay(at);
      if (minutes === null) continue;
      const bucket = Math.floor(minutes / 180);
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), minutes]);
    }
  }
  const mealSlots = [...buckets.entries()]
    .map(([bucket, values]) => ({
      label: `vers ${formatMinutes(average(values) ?? bucket * 180)}`,
      avgMin: average(values) ?? bucket * 180,
      count: values.length,
    }))
    .sort((a, b) => a.avgMin - b.avgMin);

  return {
    sampleDays: baseline.length,
    wakeUpAvgMin: average(baseline.map((day) => minutesOfDay(day.wakeUpAt) ?? NaN)),
    bedTimeAvgMin: average(baseline.map((day) => minutesOfDay(day.bedTimeAt) ?? NaN)),
    mealsAvg: average(baseline.map((day) => day.meals)),
    activeSecAvg: average(baseline.map((day) => day.activeSeconds)),
    mealSlots,
    zoneAvgSeconds,
  };
}

export type Anomaly = { level: "info" | "warn"; message: string };

/**
 * Compare la journée en cours au profil habituel. Les seuils sont volontairement
 * larges : l'objectif est de signaler un changement net (pas de repas, réveil
 * très tardif, activité effondrée), pas de produire une alerte chaque jour.
 */
export function detectAnomalies(todaySummary: DailySummary | null, habits: Habits, nowMin: number): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (!todaySummary || todaySummary.clips === 0) {
    if (nowMin > 11 * 60) {
      anomalies.push({ level: "warn", message: "Aucun mouvement détecté aujourd’hui." });
    }
    return anomalies;
  }

  const wakeUp = minutesOfDay(todaySummary.wakeUpAt);
  if (habits.wakeUpAvgMin !== null) {
    if (wakeUp === null && nowMin > habits.wakeUpAvgMin + 120) {
      anomalies.push({
        level: "warn",
        message: `Toujours dans la maison, alors qu’elle sort d’habitude vers ${formatMinutes(habits.wakeUpAvgMin)}.`,
      });
    } else if (wakeUp !== null && wakeUp > habits.wakeUpAvgMin + 90) {
      anomalies.push({
        level: "info",
        message: `Sortie tardive à ${formatMinutes(wakeUp)} (habituellement ${formatMinutes(habits.wakeUpAvgMin)}).`,
      });
    } else if (wakeUp !== null && wakeUp < habits.wakeUpAvgMin - 90) {
      anomalies.push({
        level: "info",
        message: `Sortie inhabituellement matinale à ${formatMinutes(wakeUp)}.`,
      });
    }
  }

  if (habits.mealsAvg !== null && habits.mealsAvg >= 0.5) {
    const lastSlot = habits.mealSlots.at(-1)?.avgMin ?? 14 * 60;
    if (todaySummary.meals === 0 && nowMin > lastSlot + 120) {
      anomalies.push({ level: "warn", message: "Aucun repas détecté aujourd’hui." });
    }
  }

  if (habits.activeSecAvg !== null && habits.activeSecAvg > 60) {
    // On ne compare qu'à la fraction de journée déjà écoulée pour éviter de
    // signaler une baisse d'activité à 8 h du matin.
    const elapsed = Math.min(Math.max(nowMin / (24 * 60), 0.2), 1);
    const expected = habits.activeSecAvg * elapsed;
    if (todaySummary.activeSeconds < expected * 0.4) {
      anomalies.push({ level: "warn", message: "Activité nettement plus faible que d’habitude." });
    } else if (todaySummary.activeSeconds > expected * 2) {
      anomalies.push({ level: "info", message: "Journée particulièrement agitée." });
    }
  }

  return anomalies;
}
