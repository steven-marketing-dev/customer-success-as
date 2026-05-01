import { NextRequest, NextResponse } from "next/server";
import { ClarityClient } from "@/lib/clarity";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "master") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!ClarityClient.isConfigured()) {
    return NextResponse.json({ error: "Clarity is not configured (missing CLARITY_API_TOKEN or CLARITY_PROJECT_ID)" }, { status: 400 });
  }

  try {
    const client = new ClarityClient();
    const rows = await client.syncDaily();
    return NextResponse.json({ ok: true, rows_upserted: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
