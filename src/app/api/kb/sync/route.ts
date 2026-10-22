import { NextRequest, NextResponse } from "next/server";
import { isProductFruitsConfigured, syncFromProductFruits } from "@/lib/productFruits";

export const maxDuration = 300;

/**
 * Machine-to-machine KB sync from Product Fruits (n8n calls it after publishing an article).
 *
 * Auth mirrors /api/agent/answer: x-api-key header checked against N8N_API_KEY.
 * The path is whitelisted in middleware.ts so the cookie check is skipped.
 *
 * Request:  { "dryRun"?: boolean }   — dryRun computes the changes and rolls them back
 * Response: PFSyncStats
 */
export async function POST(req: NextRequest) {
  const expected = process.env.N8N_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "N8N_API_KEY not configured" }, { status: 500 });
  }
  if (req.headers.get("x-api-key") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isProductFruitsConfigured()) {
    return NextResponse.json({ error: "PRODUCT_FRUITS_API_TOKEN not configured" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  try {
    const stats = await syncFromProductFruits({ dryRun: body.dryRun === true });
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[kb/sync] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
