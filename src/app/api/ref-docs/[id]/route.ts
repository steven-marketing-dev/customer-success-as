import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const doc = repo.getRefDocById(parseInt(id, 10));
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sections = repo.getRefDocSections(doc.id);
  return NextResponse.json({ ...doc, sections });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  const repo = new Repository();

  const existing = repo.getRefDocById(docId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as { title?: string; active?: number };
  const updated = repo.updateRefDoc(docId, {
    title: body.title,
    active: body.active,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const doc = repo.getRefDocById(parseInt(id, 10));
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  repo.deleteRefDoc(doc.id);
  return NextResponse.json({ ok: true });
}
