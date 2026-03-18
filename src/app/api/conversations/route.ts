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
  const userId = req.nextUrl.searchParams.get("userId");

  let conversations;
  if (userId) {
    conversations = repo.getUserConversations(parseInt(userId, 10));
  } else {
    // Return all conversations (users can browse each other's history)
    conversations = repo.getAllConversations();
  }

  return NextResponse.json(conversations);
}
