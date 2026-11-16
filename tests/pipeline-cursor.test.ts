import "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { runPipeline } from "@/lib/pipeline";

const repo = new Repository(getDb());

test("the next incremental sync starts from when tickets were fetched, not from when the run ended", async () => {
  let fetchedAt = 0;
  const hubspot = {
    // The run takes a while after the fetch; a ticket closed in HubSpot during that time has
    // hs_lastmodifieddate between fetchedAt and the end of the run
    getTickets: async () => { fetchedAt = Math.floor(Date.now() / 1000); await new Promise((r) => setTimeout(r, 2100)); return []; },
    getTicketAssociations: async () => { throw new Error("not used"); },
    getTicketConversation: async () => { throw new Error("not used"); },
  };
  await runPipeline({ mode: "incremental", deps: { hubspot } });
  const state = repo.getSyncState();
  const finishedAt = Math.floor(Date.now() / 1000);
  assert.ok(finishedAt - fetchedAt >= 2);
  assert.ok(state.last_sync_at! <= fetchedAt, `cursor ${state.last_sync_at} must not be after the fetch ${fetchedAt}`);
  assert.equal(state.last_run_at! >= finishedAt - 1, true);
});
