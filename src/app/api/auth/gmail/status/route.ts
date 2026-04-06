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
  const tokens = repo.getGmailTokens(session.userId);

  return NextResponse.json({
    connected: !!tokens,
    email: tokens?.gmail_email ?? null,
  });
}

export async function DELETE(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const repo = new Repository(getDb());
  repo.deleteGmailTokens(session.userId);

  return NextResponse.json({ ok: true });
}
