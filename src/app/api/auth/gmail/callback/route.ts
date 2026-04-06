import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { exchangeCode } from "@/lib/gmail/client";
import { encryptToken } from "@/lib/gmail/crypto";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  const baseUrl = req.nextUrl.origin;

  if (error) {
    return NextResponse.redirect(new URL(`/?gmailError=${encodeURIComponent(error)}`, baseUrl));
  }

  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL("/?gmailError=missing_params", baseUrl));
  }

  // Verify signed state
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/?gmailError=server_error", baseUrl));
  }

  let userId: number;
  try {
    const stateObj = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
    const expectedHmac = crypto.createHmac("sha256", secret).update(stateObj.payload).digest("hex");
    if (expectedHmac !== stateObj.hmac) {
      throw new Error("Invalid state signature");
    }
    const payload = JSON.parse(stateObj.payload);
    userId = payload.userId;
  } catch {
    return NextResponse.redirect(new URL("/?gmailError=invalid_state", baseUrl));
  }

  try {
    const tokens = await exchangeCode(code);

    const repo = new Repository(getDb());
    repo.saveGmailTokens(userId, {
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: encryptToken(tokens.refresh_token),
      token_expiry: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
      gmail_email: tokens.email,
    });

    return NextResponse.redirect(new URL("/?gmailConnected=true", baseUrl));
  } catch (err) {
    console.error("[gmail/callback] Token exchange failed:", err);
    return NextResponse.redirect(new URL("/?gmailError=exchange_failed", baseUrl));
  }
}
