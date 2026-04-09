import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HubSpotClient } from "@/lib/hubspot";

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 500 });
  }

  const { threadId, subject, body, channelId, channelAccountId, contactEmail, contactName } = await req.json() as {
    threadId: string;
    subject: string;
    body: string;
    channelId: string;
    channelAccountId: string;
    contactEmail?: string;
    contactName?: string;
  };

  if (!threadId || !body || !channelId || !channelAccountId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const client = new HubSpotClient(token);
    const result = await client.replyToThread(threadId, {
      html: body,
      subject,
      channelId,
      channelAccountId,
      contactEmail: contactEmail ?? undefined,
      contactName: contactName ?? undefined,
    });

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send HubSpot reply";
    console.error("[hubspot-reply] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
