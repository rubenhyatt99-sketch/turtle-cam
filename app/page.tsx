import { redirect } from "next/navigation";
import { Bars } from "@/components/Bars";
import { ClipGrid } from "@/components/ClipGrid";
import { EventList } from "@/components/EventList";
import { LiveView } from "@/components/LiveView";
import { Nav } from "@/components/Nav";
import { StatusBar } from "@/components/StatusBar";
import { currentUser } from "@/lib/auth";
import { getDailySummary, getStatus, listClips } from "@/lib/drive";
import { formatDay, formatDuration, formatTime, today } from "@/lib/format";
import { safe } from "@/lib/load";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const day = today();
  const [status, summary, clips] = await Promise.all([
    safe(() => getStatus(), null),
    safe(() => getDailySummary(day), null),
    safe(() => listClips({ day, limit: 8 }).then((result) => result.clips), []),
  ]);

  const zoneRows = Object.entries(summary?.zoneSeconds ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([zone, seconds]) => ({ label: zone, value: seconds, display: formatDuration(seconds) }));

  return (
    <>
      <Nav current="live" user={user} />
      <main className="shell">
        <h1>Direct</h1>
        <p className="sub">{formatDay(day)}</p>

        <div style={{ margin: "16px 0 22px" }}>
          <StatusBar status={status} />
        </div>

        <div className="grid cols-2">
          <LiveView />
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Journée en cours</h2>
            <div className="grid cols-3" style={{ marginBottom: 18 }}>
              <div className="stat">
                <span className="label">Sortie</span>
                <span className="value mono">{formatTime(summary?.wakeUpAt)}</span>
                <span className="hint">première sortie de la maison</span>
              </div>
              <div className="stat">
                <span className="label">Repas</span>
                <span className="value">{summary?.meals ?? 0}</span>
                <span className="hint">
                  {summary?.mealTimes.length ? summary.mealTimes.map((at) => formatTime(at)).join(" · ") : "aucun détecté"}
                </span>
              </div>
              <div className="stat">
                <span className="label">Activité</span>
                <span className="value mono">{formatDuration(summary?.activeSeconds ?? 0)}</span>
                <span className="hint">{summary?.clips ?? clips.length} clips</span>
              </div>
            </div>
            <Bars rows={zoneRows} />
          </div>
        </div>

        <h2>Événements du jour</h2>
        <div className="panel">
          <EventList events={summary?.events ?? []} />
        </div>

        <h2>Derniers enregistrements</h2>
        <ClipGrid clips={clips} />
      </main>
    </>
  );
}
