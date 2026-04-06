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
  const user = repo.getUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const gmailTokens = repo.getGmailTokens(session.userId);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      calendly_url: user.calendly_url,
      gmail_connected: !!gmailTokens,
      gmail_email: gmailTokens?.gmail_email ?? null,
      role: user.role,
    },
  });
}
