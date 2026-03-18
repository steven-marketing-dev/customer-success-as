import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const repo = new Repository(getDb());
  const distribution = repo.getRatingDistribution();
  const average = repo.getAverageRating();

  // Full history with actions for master accounts
  const includeHistory = session.role === "master" && req.nextUrl.searchParams.get("history") === "1";
  let history: Array<Record<string, unknown>> = [];

  if (includeHistory) {
    const messages = repo.getAllRatedMessages(100);
    history = messages.map((m) => {
      // Get actions taken for this conversation
      const actions = repo.getActionsForConversation(m.conversation_id);
      return { ...m, actions };
    });
  }

  return NextResponse.json({
    distribution,
    average: Math.round(average * 100) / 100,
    total: distribution.reduce((s, d) => s + d.count, 0),
    history,
  });
}
