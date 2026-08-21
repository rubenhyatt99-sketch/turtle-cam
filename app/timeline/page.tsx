import { redirect } from "next/navigation";
import { ClipGrid } from "@/components/ClipGrid";
import { DayPicker } from "@/components/DayPicker";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth";
import { listClips } from "@/lib/drive";
import { formatDay, formatBytes, today } from "@/lib/format";
import { safe } from "@/lib/load";

export const dynamic = "force-dynamic";

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today();
  const clips = await safe(() => listClips({ day, limit: 200 }).then((result) => result.clips), []);
  const totalBytes = clips.reduce((sum, clip) => sum + clip.sizeBytes, 0);

  return (
    <>
      <Nav current="timeline" user={user} />
      <main className="shell">
        <h1>Enregistrements</h1>
        <p className="sub">
          Rétention 7 jours · {clips.length} clips · {formatBytes(totalBytes)}
        </p>

        <div style={{ margin: "18px 0 22px" }}>
          <DayPicker basePath="/timeline" selected={day} />
        </div>

        <h2 style={{ marginTop: 0 }}>{formatDay(day)}</h2>
        <ClipGrid clips={clips} />
      </main>
    </>
  );
}
