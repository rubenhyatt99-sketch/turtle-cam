import Link from "next/link";
import { timeZone } from "@/lib/format";

/**
 * Sélecteur des 7 derniers jours — la fenêtre de rétention des clips.
 */
export function DayPicker({ basePath, selected }: { basePath: string; selected: string }) {
  const zone = timeZone();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - index * 86_400_000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
    return {
      day,
      weekday: date.toLocaleDateString("fr-FR", { weekday: "short", timeZone: zone }),
      number: date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: zone }),
    };
  });

  return (
    <div className="days">
      {days.map((entry, index) => (
        <Link
          key={entry.day}
          href={`${basePath}?day=${entry.day}`}
          className="day-chip"
          aria-current={entry.day === selected ? "page" : undefined}
        >
          {index === 0 ? "aujourd’hui" : entry.weekday}
          <b>{entry.number}</b>
        </Link>
      ))}
    </div>
  );
}
