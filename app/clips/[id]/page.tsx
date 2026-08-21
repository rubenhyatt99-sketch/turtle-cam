import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth";
import { getDailySummary, listClips } from "@/lib/drive";
import { EVENT_LABELS, formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { safe } from "@/lib/load";

export const dynamic = "force-dynamic";

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  // On retrouve les métadonnées du clip dans la liste du jour la plus récente ;
  // la fenêtre de rétention étant de 7 jours, un balayage court suffit.
  const days = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10),
  );

  let clip = null;
  let day = "";
  for (const candidate of days) {
    const clips = await safe(() => listClips({ day: candidate, limit: 200 }).then((result) => result.clips), []);
    const found = clips.find((entry) => entry.id === id);
    if (found) {
      clip = found;
      day = candidate;
      break;
    }
  }
  if (!clip) notFound();

  const summary = await safe(() => getDailySummary(day), null);
  const linkedEvents = (summary?.events ?? []).filter((event) => event.clipId === id);
  const zones = Object.entries(clip.zoneSeconds).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Nav current="timeline" user={user} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 24 }}>
          <Link href={`/timeline?day=${day}`}>← Retour aux enregistrements</Link>
        </p>
        <h1>{formatDateTime(clip.startedAt)}</h1>
        <p className="sub">
          {formatDuration(clip.durationMs / 1000)} · {formatBytes(clip.sizeBytes)} · mouvement{" "}
          {Math.round(clip.motionScore)}%
        </p>

        <video className="player" controls preload="metadata" playsInline poster={clip.thumbId ? `/api/clips/${clip.thumbId}/thumb` : undefined}>
          <source src={`/api/clips/${clip.id}/stream`} type="video/mp4" />
        </video>

        <div className="grid cols-2" style={{ marginTop: 22 }}>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Zones traversées</h2>
            {zones.length === 0 ? (
              <div className="empty-state">Mouvement hors des zones configurées.</div>
            ) : (
              <div className="status-row">
                {zones.map(([zone, seconds]) => (
                  <span className="pill" key={zone}>
                    {zone} <b>{formatDuration(seconds)}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Comportement détecté</h2>
            {linkedEvents.length === 0 ? (
              <div className="empty-state">Aucun événement rattaché à ce clip.</div>
            ) : (
              <div className="status-row">
                {linkedEvents.map((event, index) => (
                  <span className="pill" key={index}>
                    {(EVENT_LABELS[event.kind] ?? { icon: "•" }).icon}{" "}
                    <b>{(EVENT_LABELS[event.kind] ?? { label: event.kind }).label}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
