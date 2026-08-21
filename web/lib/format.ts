/** Helpers de formatage partagés par les pages du portail. */

export function timeZone(): string {
  return process.env.TIMEZONE || "Europe/Paris";
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone(),
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone(),
  });
}

export function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timeZone(),
  });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 s";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.round(seconds % 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")}`;
  if (minutes > 0) return `${minutes} min ${String(rest).padStart(2, "0")}`;
  return `${rest} s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Jour local (YYYY-MM-DD) courant dans le fuseau configuré. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone() }).format(new Date());
}

/** Étiquettes lisibles des événements de comportement. */
export const EVENT_LABELS: Record<string, { label: string; icon: string }> = {
  sortie_maison: { label: "Sortie de la maison", icon: "🚪" },
  retour_maison: { label: "Retour à la maison", icon: "🏠" },
  repas: { label: "Repas", icon: "🥬" },
  bain: { label: "Bain", icon: "💧" },
  bronzage: { label: "Bain de soleil", icon: "☀️" },
  reveil: { label: "Réveil", icon: "🌅" },
  coucher: { label: "Coucher", icon: "🌙" },
};
