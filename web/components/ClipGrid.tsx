import Link from "next/link";
import { formatDuration, formatTime } from "@/lib/format";
import type { Clip } from "@/lib/types";

/** Grille de vignettes de clips, triée du plus récent au plus ancien. */
export function ClipGrid({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) {
    return <div className="empty-state">Aucun enregistrement pour cette période.</div>;
  }

  return (
    <div className="grid clips">
      {clips.map((clip) => {
        const zones = Object.entries(clip.zoneSeconds)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        return (
          <Link key={clip.id} href={`/clips/${clip.id}`} className="clip">
            <div className="thumb">
              {clip.thumbId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/clips/${clip.thumbId}/thumb`} alt="" loading="lazy" />
              ) : (
                <div className="placeholder">🐢</div>
              )}
              <span className="dur">{formatDuration(clip.durationMs / 1000)}</span>
            </div>
            <div className="meta">
              <span className="time">{formatTime(clip.startedAt)}</span>
              <div className="zones">
                {zones.length > 0 ? (
                  zones.map(([zone, seconds]) => (
                    <span key={zone} className="tag accent">
                      {zone} {Math.round(seconds)}s
                    </span>
                  ))
                ) : (
                  <span className="tag">mouvement {Math.round(clip.motionScore)}%</span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
