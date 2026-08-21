import { NextResponse } from "next/server";
import { getDailySummary, getRecentSummaries } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const day = url.searchParams.get("day");
  try {
    if (day) return NextResponse.json({ summary: await getDailySummary(day) });
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 7), 1), 31);
    return NextResponse.json({ summaries: await getRecentSummaries(days) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
