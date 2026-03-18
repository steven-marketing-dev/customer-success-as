import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const repo = new Repository(getDb());
  const conversation = repo.getConversation(parseInt(id, 10));
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = repo.getMessages(conversation.id);
  const ratings = repo.getRatingsForConversation(conversation.id);

  return NextResponse.json({ conversation, messages, ratings });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const repo = new Repository(getDb());
  const conversation = repo.getConversation(parseInt(id, 10));
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only owner or master can delete
  if (conversation.user_id !== session.userId && session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  repo.deleteConversation(conversation.id);
  return NextResponse.json({ ok: true });
}
