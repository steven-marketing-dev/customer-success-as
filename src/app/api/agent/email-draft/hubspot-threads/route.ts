import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HubSpotClient } from "@/lib/hubspot";

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 500 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const client = new HubSpotClient(token);
    const threads = await client.searchConversationThreads(query);
    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[hubspot-threads] Error:", err);
    return NextResponse.json({ error: "Failed to search threads" }, { status: 500 });
  }
}
