import Link from "next/link";
import { EVENT_LABELS, formatDuration, formatTime } from "@/lib/format";
import type { BehaviorEvent } from "@/lib/types";

/** Journal des événements de comportement d'une journée. */
export function EventList({ events }: { events: BehaviorEvent[] }) {
  if (events.length === 0) {
    return <div className="empty-state">Aucun événement de comportement détecté.</div>;
  }

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="events">
      {sorted.map((event, index) => {
        const meta = EVENT_LABELS[event.kind] ?? { label: event.kind, icon: "•" };
        const row = (
          <>
            <span className="at">{formatTime(event.at)}</span>
            <span className="icon">{meta.icon}</span>
            <span className="what">
              {meta.label}
              {event.zone && <small>zone {event.zone} · confiance {Math.round(event.confidence * 100)}%</small>}
            </span>
            <span className="dur">{event.durationSec > 0 ? formatDuration(event.durationSec) : ""}</span>
          </>
        );
        return event.clipId ? (
          <Link className="event" key={`${event.kind}-${event.at}-${index}`} href={`/clips/${event.clipId}`}>
            {row}
          </Link>
        ) : (
          <div className="event" key={`${event.kind}-${event.at}-${index}`}>
            {row}
          </div>
        );
      })}
    </div>
  );
}
