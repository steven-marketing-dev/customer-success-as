import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET() {
  const repo = new Repository();
  const terms = repo.getAllTermsWithCounts();
  return NextResponse.json(terms);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { name: string; definition: string; aliases?: string[] };
  if (!body.name?.trim() || !body.definition?.trim()) {
    return NextResponse.json({ error: "Name and definition are required" }, { status: 400 });
  }

  const repo = new Repository();
  try {
    const term = repo.createTerm({
      name: body.name.trim(),
      definition: body.definition.trim(),
      aliases: body.aliases ?? [],
    });
    // Auto-link to existing QA pairs and articles
    repo.autoLinkTermToAll(term.id);
    const qa_count = repo.getTermQACount(term.id);
    const article_count = repo.getTermArticleCount(term.id);
    return NextResponse.json({ ...term, qa_count, article_count });
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "A term with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}
