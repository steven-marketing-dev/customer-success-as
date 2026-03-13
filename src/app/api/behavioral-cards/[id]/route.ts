import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const card = repo.getBehavioralCardById(parseInt(id, 10));
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(card);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cardId = parseInt(id, 10);
  const repo = new Repository();

  const existing = repo.getBehavioralCardById(cardId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as {
    title?: string;
    instruction?: string;
    type?: "knowledge" | "solution" | "general";
    scope?: "global" | "category";
    category_id?: number | null;
    active?: number;
  };

  const fields: Record<string, unknown> = {};
  if (body.title !== undefined) fields.title = body.title.trim();
  if (body.instruction !== undefined) fields.instruction = body.instruction.trim();
  if (body.type !== undefined) fields.type = body.type;
  if (body.scope !== undefined) fields.scope = body.scope;
  if (body.category_id !== undefined) fields.category_id = body.category_id;
  if (body.active !== undefined) fields.active = body.active;

  const updated = repo.updateBehavioralCard(cardId, fields);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const card = repo.getBehavioralCardById(parseInt(id, 10));
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  repo.deleteBehavioralCard(card.id);
  return NextResponse.json({ ok: true });
}
