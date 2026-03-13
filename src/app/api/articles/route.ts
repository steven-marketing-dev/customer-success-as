import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const repo = new Repository();

  if (q.trim()) {
    const articles = repo.searchKBArticles(q, limit, offset);
    return NextResponse.json(articles);
  }

  if (category) {
    const all = repo.getAllKBArticles().filter((a) => a.category === category);
    return NextResponse.json(all.slice(offset, offset + limit));
  }

  const articles = repo.getAllKBArticles().slice(offset, offset + limit);
  const categories = repo.getKBArticleCategories();
  const total = repo.countKBArticles();

  return NextResponse.json({ articles, categories, total });
}
