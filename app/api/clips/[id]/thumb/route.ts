import { NextResponse } from "next/server";
import { fileMeta, folderId, streamFile } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const thumbsFolder = await folderId("thumbs");
  const meta = await fileMeta(id);

  if (!thumbsFolder || !meta || !meta.parents.includes(thumbsFolder)) {
    return NextResponse.json({ error: "vignette introuvable" }, { status: 404 });
  }

  const { body } = await streamFile(id);
  return new NextResponse(body, {
    headers: {
      "content-type": meta.mimeType,
      "cache-control": "private, max-age=86400, immutable",
    },
  });
}
