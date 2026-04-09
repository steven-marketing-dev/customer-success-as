import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { generateEmailDraft } from "@/lib/ai/emailDraftGenerator";

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await req.json() as { messageId: number };
  if (!messageId) {
    return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
  }

  const repo = new Repository(getDb());

  // Fetch the assistant message and verify ownership
  const assistantMsg = repo.getMessageById(messageId);
  if (!assistantMsg || assistantMsg.role !== "assistant") {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  const conversation = repo.getConversation(assistantMsg.conversation_id);
  if (!conversation || conversation.user_id !== session.userId) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Fetch the preceding user question
  const userMsg = repo.getPrecedingUserMessage(messageId);
  const userQuestion = userMsg?.content ?? "";

  // Get user info (name + Calendly URL)
  const user = repo.getUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Extract cited articles from the assistant message's sources_json
  let articles: Array<{ title: string; url: string }> = [];
  if (assistantMsg.sources_json) {
    try {
      const parsed = JSON.parse(assistantMsg.sources_json);
      articles = (parsed.articles ?? [])
        .filter((a: { title?: string; url?: string }) => a.title && a.url)
        .map((a: { title: string; url: string }) => ({ title: a.title, url: a.url }));
    } catch { /* ignore parse errors */ }
  }

  try {
    const { subject, body } = await generateEmailDraft({
      agentAnswer: assistantMsg.content,
      userQuestion,
      senderName: user.display_name || user.username,
      calendlyUrl: user.calendly_url,
      articles,
    });

    return NextResponse.json({ subject, body });
  } catch (err) {
    console.error("[email-draft] Error:", err);
    return NextResponse.json({ error: "Failed to generate email draft" }, { status: 500 });
  }
}
