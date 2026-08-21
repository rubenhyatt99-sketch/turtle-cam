import { NextResponse } from "next/server";
import { getLiveSnapshotId, streamFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dernière image poussée par l'agent. La caméra étant sur le LAN, Vercel ne
 * peut pas l'interroger directement : l'agent dépose une image dans Drive et
 * le portail la relaie. La fraîcheur dépend de `snapshotIntervalSec`.
 */
export async function GET() {
  const id = await getLiveSnapshotId();
  if (!id) {
    return NextResponse.json({ error: "aucune image live" }, { status: 404 });
  }
  const { body } = await streamFile(id);
  return new NextResponse(body, {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}
