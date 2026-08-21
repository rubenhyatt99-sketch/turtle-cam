import { NextResponse } from "next/server";
import { listClips } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await listClips({
      day: url.searchParams.get("day") ?? undefined,
      zone: url.searchParams.get("zone") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 60),
      pageToken: url.searchParams.get("pageToken") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
