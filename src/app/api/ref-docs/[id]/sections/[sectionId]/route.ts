import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { sectionId } = await params;
  const sid = parseInt(sectionId, 10);
  const repo = new Repository();

  const body = await req.json() as { heading?: string; content?: string; section_order?: number };
  const updated = repo.updateRefDocSection(sid, {
    heading: body.heading?.trim(),
    content: body.content?.trim(),
    section_order: body.section_order,
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { sectionId } = await params;
  const repo = new Repository();
  repo.deleteRefDocSection(parseInt(sectionId, 10));
  return NextResponse.json({ ok: true });
}
