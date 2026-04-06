import { google } from "googleapis";
import { encryptToken, decryptToken } from "./crypto";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db";

const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Gmail OAuth env vars not configured (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI)");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string | null;
}> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to get tokens from Google");
  }

  // Get the user's email address
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? 0,
    email: profile.data.emailAddress ?? null,
  };
}

/**
 * Get a valid access token for a user, refreshing if expired.
 * Returns the decrypted access token and the user's gmail email.
 */
export async function getValidAccessToken(userId: number): Promise<{ accessToken: string; email: string | null } | null> {
  const repo = new Repository(getDb());
  const tokens = repo.getGmailTokens(userId);
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokens.token_expiry ?? 0;

  // If token expires within 5 minutes, refresh it
  if (now > expiresAt - 300) {
    try {
      const client = getOAuth2Client();
      const refreshToken = decryptToken(tokens.refresh_token_encrypted);
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error("No access token returned from refresh");
      }

      const newExpiry = credentials.expiry_date
        ? Math.floor(credentials.expiry_date / 1000)
        : now + 3600;

      repo.saveGmailTokens(userId, {
        access_token_encrypted: encryptToken(credentials.access_token),
        refresh_token_encrypted: tokens.refresh_token_encrypted,
        token_expiry: newExpiry,
        gmail_email: tokens.gmail_email,
      });

      return { accessToken: credentials.access_token, email: tokens.gmail_email };
    } catch (err) {
      // Only delete tokens on definitive revocation errors, not transient failures
      const message = err instanceof Error ? err.message : String(err);
      const isRevoked = message.includes("invalid_grant") || message.includes("Token has been revoked");
      if (isRevoked) {
        repo.deleteGmailTokens(userId);
      }
      return null;
    }
  }

  return { accessToken: decryptToken(tokens.access_token_encrypted), email: tokens.gmail_email };
}

/**
 * Create a draft in the user's Gmail account.
 */
export async function createGmailDraft(
  accessToken: string,
  subject: string,
  htmlBody: string,
  fromEmail: string
): Promise<{ draftId: string }> {
  const client = getOAuth2Client();
  client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth: client });

  // Build RFC 2822 MIME message
  const messageParts = [
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ];
  const rawMessage = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw: encodedMessage },
    },
  });

  return { draftId: res.data.id ?? "" };
}
