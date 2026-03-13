import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("category")
    ? parseInt(searchParams.get("category")!, 10)
    : undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const repo = new Repository();
    const results = repo.searchQAPairs(query, categoryId, limit, offset);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
