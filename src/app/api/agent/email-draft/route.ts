import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { getValidAccessToken, createGmailDraft } from "@/lib/gmail/client";
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

  // Get valid Gmail access token
  const tokenResult = await getValidAccessToken(session.userId);
  if (!tokenResult) {
    return NextResponse.json({ error: "gmail_not_connected" }, { status: 400 });
  }

  try {
    // Generate email draft content via AI
    const { subject, body } = await generateEmailDraft({
      agentAnswer: assistantMsg.content,
      userQuestion,
      senderName: user.display_name || user.username,
      calendlyUrl: user.calendly_url,
    });

    // Create draft in Gmail
    const { draftId } = await createGmailDraft(
      tokenResult.accessToken,
      subject,
      body,
      tokenResult.email ?? ""
    );

    return NextResponse.json({ success: true, draftId, subject });
  } catch (err) {
    console.error("[email-draft] Error:", err);

    // Check if it's a Gmail auth error
    const message = err instanceof Error ? err.message : "";
    if (message.includes("invalid_grant") || message.includes("Token has been expired")) {
      // Token was revoked — clean up
      repo.deleteGmailTokens(session.userId);
      return NextResponse.json({ error: "gmail_reauth_required" }, { status: 401 });
    }

    return NextResponse.json({ error: "Failed to create email draft" }, { status: 500 });
  }
}
