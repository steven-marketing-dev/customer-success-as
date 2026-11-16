import { mock, localDate } from "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { runWidgetReportsTick, STALE_SENDING_SECONDS } from "@/lib/widget-report-scheduler";
import { latestCompletedPeriod } from "@/lib/widget-usage-report";
import { localDateString } from "@/lib/db/index";

// A 7-day period that ended at today's local midnight in Los Angeles
process.env.WIDGET_REPORTS_ANCHOR = localDate("America/Los_Angeles", -7);

const db = getDb();
const repo = new Repository(db);
const user = repo.getUserByUsername("admin")!;
const quiet = () => {};
const rows = () => db.prepare("SELECT status, attempts, period_end_date FROM widget_report_sends ORDER BY id").all() as Array<{ status: string; attempts: number; period_end_date: string }>;

function reset(tz = "America/Los_Angeles") {
  db.exec("DELETE FROM widget_report_sends");
  repo.updateUserProfile(user.id, { email: "owner@example.com", timezone: tz, report_7d: true });
  mock.sent.length = 0;
  mock.sendgridStatus = 202;
}

async function silenced(fn: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.error = original; }
  return errors;
}

test("a due report is sent once, however many times the job ticks", async () => {
  reset();
  await runWidgetReportsTick(quiet);
  await runWidgetReportsTick(quiet);
  assert.equal(mock.sent.length, 1);
  assert.deepEqual(rows().map((r) => r.status), ["sent"]);
});

test("a report left in 'sending' by a restart is retried once it is stale, not before", async () => {
  reset();
  const period = latestCompletedPeriod(7, "America/Los_Angeles")!;
  // The tick claimed the row and the container restarted before the email went out
  repo.claimWidgetReportSend(user.id, 7, period.start, period.end, localDateString(period.end, "America/Los_Angeles"));
  await runWidgetReportsTick(quiet);
  assert.equal(mock.sent.length, 0, "a fresh 'sending' row may still be in flight");
  db.prepare("UPDATE widget_report_sends SET claimed_at = unixepoch() - ?").run(STALE_SENDING_SECONDS + 1);
  await runWidgetReportsTick(quiet);
  assert.equal(mock.sent.length, 1);
  assert.deepEqual(rows(), [{ status: "sent", attempts: 2, period_end_date: localDateString(period.end, "America/Los_Angeles") }]);
});

test("changing the timezone does not send the same period again", async () => {
  reset();
  await runWidgetReportsTick(quiet);
  repo.updateUserProfile(user.id, { timezone: "America/New_York" });
  await runWidgetReportsTick(quiet);
  await runWidgetReportsTick(quiet);
  assert.equal(mock.sent.length, 1);
  assert.equal(rows().length, 1);
});

test("three failed attempts end in a visible failure, logged as an error", async () => {
  reset();
  mock.sendgridStatus = 500;
  const errors = await silenced(async () => { for (let i = 0; i < 5; i++) await runWidgetReportsTick(quiet); });
  assert.deepEqual(rows().map((r) => [r.status, r.attempts]), [["failed", 3]]);
  assert.ok(errors.some((e) => e.includes("ERROR") && e.includes("gave up")));
  assert.deepEqual(repo.countWidgetReportProblems(0, STALE_SENDING_SECONDS), { failed: 1, stuck: 0 });
});

test("a stuck send with no attempts left becomes a failure instead of staying in 'sending'", async () => {
  reset();
  const period = latestCompletedPeriod(7, "America/Los_Angeles")!;
  repo.claimWidgetReportSend(user.id, 7, period.start, period.end, localDateString(period.end, "America/Los_Angeles"));
  db.prepare("UPDATE widget_report_sends SET attempts = 3, claimed_at = unixepoch() - ?").run(STALE_SENDING_SECONDS + 1);
  const errors = await silenced(() => runWidgetReportsTick(quiet));
  assert.deepEqual(rows().map((r) => r.status), ["failed"]);
  assert.ok(errors.some((e) => e.includes("interrupted")));
});

test("a missing email configuration is reported as an error, not a plain log line", async () => {
  reset();
  const key = process.env.SENDGRID_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  const errors = await silenced(() => runWidgetReportsTick(quiet));
  process.env.SENDGRID_API_KEY = key;
  assert.ok(errors.some((e) => e.includes("not configured")));
  assert.equal(rows().length, 0, "nothing is claimed, so it is sent once the configuration is fixed");
});
