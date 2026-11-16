import { mock } from "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { syncFromProductFruits } from "@/lib/productFruits";
import { isJobRunning } from "@/lib/locks";

const db = getDb();
const repo = new Repository(db);
const stored = () => repo.countKBArticles();

function reset() {
  db.exec("DELETE FROM kb_articles; DELETE FROM app_meta WHERE key = 'kb_sync_last'");
  mock.pfListings = 0;
  mock.pfMaxConcurrentListings = 0;
  mock.pfDelayMs = 100;
}

test("a real sync that arrives during a dry run still writes", async () => {
  reset();
  const dry = syncFromProductFruits({ dryRun: true });
  const real = await syncFromProductFruits({});
  assert.equal((await dry).dryRun, true);
  assert.equal(real.dryRun, false);
  assert.equal(real.created, 2);
  assert.equal(stored(), 2);
  assert.equal(mock.pfMaxConcurrentListings, 1, "the real sync waited for the dry run");
});

test("two real syncs at once share one run", async () => {
  reset();
  const [a, b] = await Promise.all([syncFromProductFruits({}), syncFromProductFruits({})]);
  assert.equal(mock.pfListings, 1);
  assert.equal(a, b);
  assert.equal(stored(), 2);
});

test("a dry run that arrives during a real sync shares it and says it was real", async () => {
  reset();
  const real = syncFromProductFruits({});
  const dry = await syncFromProductFruits({ dryRun: true });
  await real;
  assert.equal(dry.dryRun, false);
  assert.equal(mock.pfListings, 1);
});

test("a dry run writes nothing and is not recorded as the last sync", async () => {
  reset();
  const dry = await syncFromProductFruits({ dryRun: true });
  assert.equal(dry.created, 2);
  assert.equal(stored(), 0);
  assert.equal(repo.getAppMeta("kb_sync_last"), null);
});

test("the lock is released and the outcome recorded, also when the sync fails", async () => {
  reset();
  await syncFromProductFruits({});
  assert.equal(isJobRunning("kb-sync"), false);
  assert.equal(JSON.parse(repo.getAppMeta("kb_sync_last")!).ok, true);

  const token = process.env.PRODUCT_FRUITS_API_TOKEN;
  delete process.env.PRODUCT_FRUITS_API_TOKEN;
  await assert.rejects(syncFromProductFruits({}));
  process.env.PRODUCT_FRUITS_API_TOKEN = token;
  assert.equal(isJobRunning("kb-sync"), false);
  assert.equal(JSON.parse(repo.getAppMeta("kb_sync_last")!).ok, false);
});
