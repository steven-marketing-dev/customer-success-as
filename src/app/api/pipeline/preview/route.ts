import { NextRequest, NextResponse } from "next/server";
import { HubSpotClient } from "@/lib/hubspot";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { mode = "incremental" } = await req.json() as { mode?: string };

  if (!["incremental", "full"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const repo = new Repository(getDb());
  const hubspot = new HubSpotClient(process.env.HUBSPOT_ACCESS_TOKEN!);

  const syncState = repo.getSyncState();
  const modifiedAfter =
    mode === "incremental" && syncState.last_sync_at
      ? new Date(syncState.last_sync_at * 1000)
      : null;

  const syncLimit = parseInt(process.env.SYNC_LIMIT ?? "0", 10);

  const rawTickets = await hubspot.getTickets({
    modifiedAfter,
    limit: syncLimit,
    closedOnly: true,
  });

  // Count how many are new vs already in DB
  let newCount = 0;
  let updatedCount = 0;
  for (const raw of rawTickets) {
    const existing = repo.getTicketByHubspotId(raw.id);
    if (!existing) {
      newCount++;
    } else {
      updatedCount++;
    }
  }

  const unprocessed = repo.getUnprocessedTickets().length;

  return NextResponse.json({
    total: rawTickets.length,
    new: newCount,
    updated: updatedCount,
    unprocessed_in_db: unprocessed,
    mode,
    since: modifiedAfter?.toISOString().slice(0, 10) ?? null,
  });
}
