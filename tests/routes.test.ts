import { mock } from "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { createSession, requireAuth } from "@/lib/auth";
import { acquireJob, releaseJob } from "@/lib/locks";
import { POST as clearDb } from "@/app/api/db/clear/route";
import { POST as followUp } from "@/app/api/widget/follow-up/route";
import { POST as widgetTicket } from "@/app/api/widget/ticket/route";
import { GET as status } from "@/app/api/status/route";
import { PUT as updateQa } from "@/app/api/qa/[id]/route";

const db = getDb();
const repo = new Repository(db);
const admin = repo.getUserByUsername("admin")!;
const agent = repo.createUser({ username: "agent1", password_hash: "x", display_name: "Agent", role: "user" });
const installation = repo.createWidgetInstallation({ key: "k-test", name: "Test site", allowed_origins: ["*"] });

/** A request as the middleware forwards it: identity in x-user-* headers. */
const as = (user: { id: number; role: string } | null, url = "http://localhost/api/x", init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-user-id": String(user.id), "x-user-role": user.role } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

test("a deleted user's session stops working, and the role comes from the users table", () => {
  const gone = repo.createUser({ username: "gone", password_hash: "x", display_name: null, role: "user" });
  assert.deepEqual(requireAuth(as(gone)), { userId: gone.id, role: "user" });
  // A token that claims master for a normal user is not believed
  assert.equal(requireAuth(as({ id: gone.id, role: "master" }))!.role, "user");
  repo.deleteUser(gone.id);
  assert.equal(requireAuth(as(gone)), null);
});

test("routes that change data refuse a deleted user", async () => {
  const gone = repo.createUser({ username: "gone2", password_hash: "x", display_name: null, role: "user" });
  repo.deleteUser(gone.id);
  const res = await updateQa(as(gone, "http://localhost/api/qa/1", { method: "PUT", body: { answer: "x" } }), { params: Promise.resolve({ id: "1" }) });
  assert.equal(res.status, 401);
});

function seedKb() {
  db.exec("DELETE FROM behavioral_cards; DELETE FROM widget_gap_reviews; DELETE FROM widget_questions; DELETE FROM qa_category_map; DELETE FROM qa_pairs; DELETE FROM categories; DELETE FROM tickets;");
  const billing = repo.getOrCreateCategory("Billing", "Invoices");
  const other = repo.getOrCreateCategory("Exports", "x");
  const rule = repo.createBehavioralCard({ title: "Refunds", instruction: "Never promise a refund", type: "general", scope: "category", category_id: billing.id });
  db.prepare("INSERT INTO widget_questions (installation_id, exchange_id, question, question_norm, answer, ip_hash, status, created_at) VALUES (?, 'ex-gap', 'How do I export candidates?', 'how do i export candidates', 'no documented guidance', 'ip', 'unanswered', unixepoch() - 600)").run(installation.id);
  db.prepare("INSERT INTO widget_questions (installation_id, exchange_id, question, question_norm, answer, ip_hash, status, created_at) VALUES (?, 'ex-gap2', 'Where is the invoice?', 'where is the invoice', 'no documented guidance', 'ip', 'unanswered', unixepoch() - 600)").run(installation.id);
  const qa = repo.createWidgetGapQA("How do I export candidates?", "Use Reports > Export zebracsv.");
  repo.assignCategory(qa.id, other.id);
  db.exec("INSERT INTO qa_pairs_fts(qa_pairs_fts) VALUES('rebuild')");
  repo.reviewWidgetGap("how do i export candidates", "answered", qa.id, admin.id);
  repo.reviewWidgetGap("where is the invoice", "dismissed", null, admin.id);
  return { billing, rule };
}
const since = () => Math.floor(Date.now() / 1000) - 3600;

test("Clear DB is for an existing master only, and not while a job runs", async () => {
  seedKb();
  assert.equal((await clearDb(as(null))).status, 401);
  assert.equal((await clearDb(as(agent))).status, 403);
  acquireJob("pipeline");
  assert.equal((await clearDb(as(admin))).status, 409);
  releaseJob("pipeline");
  assert.equal(repo.countQAPairs(), 1, "nothing was deleted by the refused calls");
});

test("Clear DB leaves rules, the gap queue and the search index coherent", async () => {
  const { billing, rule } = seedKb();
  assert.equal(repo.listWidgetGaps(since()).length, 0);
  const res = await clearDb(as(admin));
  assert.equal(res.status, 200);
  assert.equal(repo.countQAPairs(), 0);
  assert.equal(repo.getBehavioralCardById(rule.id)!.category_id, billing.id, "the rule keeps its category");
  assert.deepEqual(repo.getAllCategories().map((c) => c.name), ["Billing"]);
  assert.deepEqual(repo.listWidgetGaps(since()).map((g) => g.question_norm), ["how do i export candidates"], "the answered gap is open again; the dismissed one stays dismissed");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM qa_pairs_fts WHERE qa_pairs_fts MATCH 'zebracsv'").get() as { n: number }).n, 0);
});

const widgetReq = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/widget/${path}?key=k-test`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://example.test" }, body: JSON.stringify(body),
  });
const followUpBody = (extra: Record<string, unknown> = {}) => ({
  exchangeId: "ex-1234567", question: "How do I export?", answer: "I do not have documented guidance", reason: "no_answer",
  message: "Please help", email: "visitor@example.com", sessionId: "sess-12345678", ...extra,
});
const followUps = () => (db.prepare("SELECT COUNT(*) n FROM widget_events WHERE event_type = 'follow_up_request'").get() as { n: number }).n;

test("the same follow-up sent twice reaches support once", async () => {
  mock.sent.length = 0;
  const first = await followUp(widgetReq("follow-up", followUpBody()));
  const second = await followUp(widgetReq("follow-up", followUpBody()));
  assert.equal(first.status, 200);
  assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  assert.equal(mock.sent.length, 1);
  assert.equal(followUps(), 1);
});

test("two identical follow-ups arriving together share one send", async () => {
  mock.sent.length = 0;
  const body = followUpBody({ exchangeId: "ex-concurrent" });
  const [a, b] = await Promise.all([followUp(widgetReq("follow-up", body)), followUp(widgetReq("follow-up", body))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(mock.sent.length, 1);
});

test("a different reason or exchange is a different follow-up, and a failed send can be retried", async () => {
  mock.sent.length = 0;
  await followUp(widgetReq("follow-up", followUpBody({ reason: "not_helpful" })));
  await followUp(widgetReq("follow-up", followUpBody({ exchangeId: "ex-other-1" })));
  assert.equal(mock.sent.length, 2);

  mock.sendgridStatus = 500;
  const errors = console.error;
  console.error = () => {};
  const failed = await followUp(widgetReq("follow-up", followUpBody({ exchangeId: "ex-retry-1" })));
  console.error = errors;
  mock.sendgridStatus = 202;
  assert.equal(failed.status, 502);
  const retried = await followUp(widgetReq("follow-up", followUpBody({ exchangeId: "ex-retry-1" })));
  assert.deepEqual(await retried.json(), { ok: true });
  assert.equal(mock.sent.length, 3);
});

test("a double-submitted widget email is sent once; a different message goes through", async () => {
  mock.sent.length = 0;
  const body = { subject: "Cannot log in", description: "It says wrong password", email: "visitor@example.com", sessionId: "sess-12345678" };
  await Promise.all([widgetTicket(widgetReq("ticket", body)), widgetTicket(widgetReq("ticket", body))]);
  await widgetTicket(widgetReq("ticket", body));
  assert.equal(mock.sent.length, 1);
  await widgetTicket(widgetReq("ticket", { ...body, description: "Now it says account locked" }));
  assert.equal(mock.sent.length, 2);
});

test("GET /api/status needs the cookie or the API key, and does not trust identity headers", async () => {
  const get = (headers: Record<string, string>) => status(new NextRequest("http://localhost/api/status", { headers }));
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ "x-user-id": String(admin.id), "x-user-role": "master" })).status, 401);
  assert.equal((await get({ "x-api-key": "wrong" })).status, 401);
  assert.equal((await get({ cookie: `session=${await createSession(admin.id, "master")}` })).status, 200);

  const res = await get({ "x-api-key": "test-n8n-key" });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.schema.applied, true);
  assert.deepEqual(body.running, []);
  assert.equal(typeof body.pipeline.unprocessed_tickets, "number");
  assert.equal(body.widget_reports.enabled, false);
  assert.ok(!text.includes("@"), "no emails in the payload");
});
