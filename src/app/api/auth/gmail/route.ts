import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAuthUrl } from "@/lib/gmail/client";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Sign the user ID into the state param to prevent CSRF
  const payload = JSON.stringify({ userId: session.userId, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const state = Buffer.from(JSON.stringify({ payload, hmac })).toString("base64url");

  try {
    const authUrl = getAuthUrl(state);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error("[gmail/auth] Error generating auth URL:", err);
    return NextResponse.json({ error: "Gmail OAuth not configured" }, { status: 500 });
  }
}
