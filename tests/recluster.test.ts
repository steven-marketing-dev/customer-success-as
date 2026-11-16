import "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { executeRecluster, type ReclusterCategorizer } from "@/lib/pipeline";

const db = getDb();
const repo = new Repository(db);
const quiet = () => {};

function seed() {
  db.exec("DELETE FROM behavioral_cards; DELETE FROM qa_category_map; DELETE FROM qa_pairs; DELETE FROM categories; DELETE FROM tickets;");
  const ticket = repo.upsertTicket({ hubspot_id: `t-${Math.random()}` });
  const qa = [1, 2, 3].map((i) => repo.createQAPair({ ticket_id: ticket.id, question: `Billing question ${i}`, answer: "a", summary: null, resolved: true, channel: null }));
  const billing = repo.getOrCreateCategory("Billing", "Invoices");
  for (const q of qa) repo.assignCategory(q.id, billing.id);
  const rule = repo.createBehavioralCard({ title: "Refunds", instruction: "Never promise a refund", type: "general", scope: "category", category_id: billing.id });
  return { qa, billing, rule };
}

const mapped = () => (db.prepare("SELECT COUNT(*) n FROM qa_category_map").get() as { n: number }).n;

test("a re-cluster that fails leaves categories and assignments as they were", async () => {
  const { billing } = seed();
  const failing: ReclusterCategorizer = {
    reclusterAll: async () => { throw new Error("LLM down"); },
    categorizeSingle: async () => { throw new Error("LLM down"); },
  };
  await assert.rejects(executeRecluster(repo, failing, repo.getAllQAWithCategories(), quiet));
  assert.deepEqual(repo.getAllCategories().map((c) => c.id), [billing.id]);
  assert.equal(mapped(), 3);
});

test("a category-scoped rule keeps its category when the taxonomy keeps the name", async () => {
  const { qa, billing, rule } = seed();
  const same: ReclusterCategorizer = {
    reclusterAll: async () => ({ categories: [{ name: "Billing", description: "Invoices and payments", qa_ids: qa.map((q) => q.id) }], unassignedIds: [] }),
    categorizeSingle: async () => { throw new Error("not used"); },
  };
  await executeRecluster(repo, same, repo.getAllQAWithCategories(), quiet);
  assert.equal(repo.getBehavioralCardById(rule.id)!.category_id, billing.id);
  assert.equal(repo.getBehavioralCardsForCategories([billing.id]).length, 1);
});

test("a category the new taxonomy drops stays while a rule points to it; unused ones go", async () => {
  const { qa, billing, rule } = seed();
  const other = repo.getOrCreateCategory("Old unused", "nothing points here after the re-cluster");
  const renamed: ReclusterCategorizer = {
    reclusterAll: async () => ({ categories: [{ name: "Payments", description: "Renamed", qa_ids: [qa[0].id, qa[1].id] }], unassignedIds: [qa[2].id] }),
    categorizeSingle: async (_qa, existing) => {
      assert.deepEqual(existing.map((c) => c.name), ["Payments"], "the fallback sees the new taxonomy, not the stored one");
      return { action: "assign", category_name: "Payments", confidence: 0.8 };
    },
  };
  await executeRecluster(repo, renamed, repo.getAllQAWithCategories(), quiet);
  const names = repo.getAllCategories().map((c) => c.name).sort();
  assert.deepEqual(names, ["Billing", "Payments"]);
  assert.equal(repo.getBehavioralCardById(rule.id)!.category_id, billing.id);
  assert.equal(repo.getCategoryByName("Old unused"), undefined);
  assert.equal(other.id > 0, true);
  assert.equal(mapped(), 3);
  // The kept category has no Q&A left, so the rule no longer matches any question: that is
  // what the Rules tab flags as "category has no Q&A" (it reads `count` from /api/kb)
  assert.equal(repo.getCategorySummary().find((c) => c.id === billing.id)!.count, 0);
});

test("a Q&A the taxonomy puts in two categories keeps both", async () => {
  const { qa } = seed();
  const c: ReclusterCategorizer = {
    reclusterAll: async () => ({ categories: [
      { name: "Payments", description: "p", qa_ids: qa.map((q) => q.id) },
      { name: "Refunds", description: "r", qa_ids: [qa[0].id] },
    ], unassignedIds: [] }),
    categorizeSingle: async () => { throw new Error("not used"); },
  };
  await executeRecluster(repo, c, repo.getAllQAWithCategories(), quiet);
  assert.equal(mapped(), 4);
});

test("a Q&A created while the AI was thinking keeps its category", async () => {
  const { qa } = seed();
  const snapshot = repo.getAllQAWithCategories();
  const ticket = repo.upsertTicket({ hubspot_id: "late" });
  const late = repo.createQAPair({ ticket_id: ticket.id, question: "Late question", answer: "a", summary: null, resolved: true, channel: null });
  const gapCategory = repo.getOrCreateCategory("Exports", "x");
  repo.assignCategory(late.id, gapCategory.id);
  const c: ReclusterCategorizer = {
    reclusterAll: async () => ({ categories: [{ name: "Payments", description: "p", qa_ids: qa.map((q) => q.id) }], unassignedIds: [] }),
    categorizeSingle: async () => { throw new Error("not used"); },
  };
  await executeRecluster(repo, c, snapshot, quiet);
  const row = db.prepare("SELECT category_id FROM qa_category_map WHERE qa_id = ?").get(late.id) as { category_id: number };
  assert.equal(row.category_id, gapCategory.id);
});
