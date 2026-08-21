import { redirect } from "next/navigation";
import { Bars } from "@/components/Bars";
import { EventList } from "@/components/EventList";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth";
import { getRecentSummaries } from "@/lib/drive";
import { formatDay, formatDuration, today } from "@/lib/format";
import { computeHabits, detectAnomalies, formatMinutes, minutesOfDay } from "@/lib/insights";
import { safe } from "@/lib/load";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const day = today();
  const summaries = await safe(() => getRecentSummaries(7), []);
  const todaySummary = summaries.find((entry) => entry.day === day) ?? null;
  const baseline = summaries.filter((entry) => entry.day !== day);

  const habits = computeHabits(baseline);
  const nowMin = minutesOfDay(new Date().toISOString()) ?? 0;
  const anomalies = detectAnomalies(todaySummary, habits, nowMin);

  const activityRows = summaries.map((entry) => ({
    label: formatDay(entry.day).split(" ").slice(0, 2).join(" "),
    value: entry.activeSeconds,
    display: formatDuration(entry.activeSeconds),
  }));

  const zoneRows = Object.entries(habits.zoneAvgSeconds)
    .sort((a, b) => b[1] - a[1])
    .map(([zone, seconds]) => ({ label: zone, value: seconds, display: `${formatDuration(seconds)}/j` }));

  const mealRows = summaries.map((entry) => ({
    label: formatDay(entry.day).split(" ").slice(0, 2).join(" "),
    value: entry.meals,
    display: `${entry.meals}`,
  }));

  return (
    <>
      <Nav current="insights" user={user} />
      <main className="shell">
        <h1>Comportement</h1>
        <p className="sub">
          Analyse sur {summaries.length} jour{summaries.length > 1 ? "s" : ""} de données
          {habits.sampleDays > 0 ? ` · référence calculée sur ${habits.sampleDays} jours` : ""}
        </p>

        {anomalies.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "18px 0" }}>
            {anomalies.map((anomaly, index) => (
              <div className="notice" key={index} style={anomaly.level === "warn" ? undefined : { borderLeftColor: "var(--accent)" }}>
                {anomaly.level === "warn" ? "⚠️ " : "ℹ️ "}
                {anomaly.message}
              </div>
            ))}
          </div>
        )}

        <div className="grid cols-3" style={{ marginTop: 18 }}>
          <div className="panel stat">
            <span className="label">Sortie habituelle</span>
            <span className="value mono">{formatMinutes(habits.wakeUpAvgMin)}</span>
            <span className="hint">
              aujourd’hui : {formatMinutes(minutesOfDay(todaySummary?.wakeUpAt))}
            </span>
          </div>
          <div className="panel stat">
            <span className="label">Retour habituel</span>
            <span className="value mono">{formatMinutes(habits.bedTimeAvgMin)}</span>
            <span className="hint">
              aujourd’hui : {formatMinutes(minutesOfDay(todaySummary?.bedTimeAt))}
            </span>
          </div>
          <div className="panel stat">
            <span className="label">Repas / jour</span>
            <span className="value">{habits.mealsAvg === null ? "—" : habits.mealsAvg.toFixed(1)}</span>
            <span className="hint">
              {habits.mealSlots.length > 0
                ? habits.mealSlots.map((slot) => slot.label).join(" · ")
                : "pas encore de rythme identifié"}
            </span>
          </div>
        </div>

        <div className="grid cols-2" style={{ marginTop: 16 }}>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Activité par jour</h2>
            <Bars rows={activityRows} />
          </div>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Temps moyen par zone</h2>
            <Bars rows={zoneRows} />
          </div>
        </div>

        <div className="grid cols-2" style={{ marginTop: 16 }}>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Repas par jour</h2>
            <Bars rows={mealRows} />
          </div>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Journal d’aujourd’hui</h2>
            <EventList events={todaySummary?.events ?? []} />
          </div>
        </div>
      </main>
    </>
  );
}
