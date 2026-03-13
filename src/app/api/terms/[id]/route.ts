import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const term = repo.getTermById(parseInt(id, 10));
  if (!term) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const qaPairs = repo.getQAsForTerm(term.id);
  const articles = repo.getArticlesForTerm(term.id);
  return NextResponse.json({ ...term, qa_pairs: qaPairs, articles });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const termId = parseInt(id, 10);
  const repo = new Repository();

  const existing = repo.getTermById(termId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as { name?: string; definition?: string; aliases?: string[] };
  const fields: { name?: string; definition?: string; aliases?: string[] } = {};
  if (body.name !== undefined) fields.name = body.name.trim();
  if (body.definition !== undefined) fields.definition = body.definition.trim();
  if (body.aliases !== undefined) fields.aliases = body.aliases;

  const updated = repo.updateTerm(termId, fields);
  // Re-link to QAs and articles based on updated name/aliases
  repo.autoLinkTermToAll(termId);
  const qa_count = repo.getTermQACount(termId);
  const article_count = repo.getTermArticleCount(termId);
  return NextResponse.json({ ...updated, qa_count, article_count });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = new Repository();
  const term = repo.getTermById(parseInt(id, 10));
  if (!term) return NextResponse.json({ error: "Not found" }, { status: 404 });

  repo.deleteTerm(term.id);
  return NextResponse.json({ ok: true });
}
