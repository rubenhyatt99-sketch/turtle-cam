import { NextResponse } from "next/server";
import { fileMeta, folderId, streamFile } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Relaie un clip depuis Drive. Le parent du fichier est vérifié pour que cette
 * route ne puisse pas servir de proxy vers n'importe quel fichier du compte.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const clipsFolder = await folderId("clips");
  const meta = await fileMeta(id);

  if (!clipsFolder || !meta || !meta.parents.includes(clipsFolder)) {
    return NextResponse.json({ error: "clip introuvable" }, { status: 404 });
  }

  const range = request.headers.get("range") ?? undefined;
  const { body, headers, status } = await streamFile(id, range);
  return new NextResponse(body, {
    status,
    headers: {
      ...headers,
      "content-type": meta.mimeType,
      "cache-control": "private, max-age=3600",
    },
  });
}
