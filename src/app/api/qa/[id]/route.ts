import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const qa = repo.getQAPairById(parseInt(id, 10));
  if (!qa) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(qa);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const qaId = parseInt(id, 10);
  const repo = new Repository();

  const existing = repo.getQAPairById(qaId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;

  const fields: Record<string, unknown> = {};
  if (body.question !== undefined) fields.question = body.question;
  if (body.answer !== undefined) fields.answer = body.answer;
  if (body.resolution_steps !== undefined) fields.resolution_steps = body.resolution_steps;
  if (body.summary !== undefined) fields.summary = body.summary;
  if (body.resolved !== undefined) fields.resolved = body.resolved;

  const updated = repo.updateQAPair(qaId, fields);
  return NextResponse.json(updated);
}
