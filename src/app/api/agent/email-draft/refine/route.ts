import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { refineEmailDraft } from "@/lib/ai/emailDraftGenerator";

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId, subject, body, instruction } = await req.json() as {
    messageId: number;
    subject: string;
    body: string;
    instruction: string;
  };

  if (!messageId || !instruction?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const repo = new Repository(getDb());

  // Fetch original context for grounding
  const assistantMsg = repo.getMessageById(messageId);
  if (!assistantMsg || assistantMsg.role !== "assistant") {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  const conversation = repo.getConversation(assistantMsg.conversation_id);
  if (!conversation || conversation.user_id !== session.userId) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const userMsg = repo.getPrecedingUserMessage(messageId);
  const user = repo.getUserById(session.userId);

  try {
    const result = await refineEmailDraft({
      currentSubject: subject,
      currentBody: body,
      instruction,
      agentAnswer: assistantMsg.content,
      userQuestion: userMsg?.content ?? "",
      senderName: user?.display_name || user?.username || "",
      calendlyUrl: user?.calendly_url,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[email-draft/refine] Error:", err);
    return NextResponse.json({ error: "Failed to refine draft" }, { status: 500 });
  }
}
