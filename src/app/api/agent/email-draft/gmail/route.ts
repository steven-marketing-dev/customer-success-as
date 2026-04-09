import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { getValidAccessToken, createGmailDraft } from "@/lib/gmail/client";

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { subject, body } = await req.json() as { subject: string; body: string };
  if (!subject || !body) {
    return NextResponse.json({ error: "Missing subject or body" }, { status: 400 });
  }

  const tokenResult = await getValidAccessToken(session.userId);
  if (!tokenResult) {
    return NextResponse.json({ error: "gmail_not_connected" }, { status: 400 });
  }

  try {
    const { draftId } = await createGmailDraft(
      tokenResult.accessToken,
      subject,
      body,
      tokenResult.email ?? ""
    );

    return NextResponse.json({ success: true, draftId });
  } catch (err) {
    console.error("[email-draft/gmail] Error:", err);

    const message = err instanceof Error ? err.message : "";
    if (message.includes("invalid_grant") || message.includes("Token has been expired")) {
      const repo = new Repository(getDb());
      repo.deleteGmailTokens(session.userId);
      return NextResponse.json({ error: "gmail_reauth_required" }, { status: 401 });
    }

    return NextResponse.json({ error: "Failed to create Gmail draft" }, { status: 500 });
  }
}
