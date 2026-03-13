import { NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repo = new Repository();
    const [tickets, qaPairs, categories, recent, syncState] = [
      repo.countTickets(),
      repo.countQAPairs(),
      repo.getCategorySummary(),
      repo.getRecentQA(8),
      repo.getSyncState(),
    ];

    return NextResponse.json({
      stats: {
        tickets,
        qa_pairs: qaPairs,
        categories: categories.length,
        last_sync_at: syncState.last_sync_at,
      },
      categories,
      recent_qa: recent,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
