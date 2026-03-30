import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") ?? "";
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const repo = new Repository();

  if (query.trim()) {
    const cards = repo.searchProcessCards(query, limit);
    return NextResponse.json({ cards, total: cards.length });
  }

  const cards = repo.getAllProcessCards(limit);
  const total = repo.countProcessCards();
  return NextResponse.json({ cards, total });
}
