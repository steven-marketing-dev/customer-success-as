import "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

test("a database from before DIS-412 is migrated: report sends get their local end date", async () => {
  // The tables as the previous release created them, with real-looking rows, before the app opens the file
  const old = new Database(process.env.DATABASE_PATH!);
  old.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('master', 'user')), created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      calendly_url TEXT, email TEXT, timezone TEXT, report_7d INTEGER NOT NULL DEFAULT 0, report_30d INTEGER NOT NULL DEFAULT 0, report_90d INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE widget_report_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_days INTEGER NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending', attempts INTEGER NOT NULL DEFAULT 1, error TEXT, sent_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(user_id, period_days, period_end)
    );
    INSERT INTO users (username, password_hash, role, email, timezone, report_7d) VALUES ('owner', 'x', 'master', 'owner@example.com', 'America/New_York', 1);
  `);
  // 2026-11-09 00:00 in Los Angeles and in New York: the same weekly period sent twice after a
  // timezone change (what the old key allowed), plus an earlier period and one stuck in 'sending'
  const la = Date.UTC(2026, 10, 9, 8) / 1000;
  const ny = Date.UTC(2026, 10, 9, 5) / 1000;
  const insert = old.prepare("INSERT INTO widget_report_sends (user_id, period_days, period_start, period_end, status) VALUES (1, 7, ?, ?, ?)");
  insert.run(ny - 7 * 86400, ny, "sent");
  insert.run(la - 7 * 86400, la, "sent");
  insert.run(ny - 14 * 86400, ny - 7 * 86400, "sent");
  insert.run(ny + 0, ny + 7 * 86400, "sending");
  old.close();

  const { getDb } = await import("@/lib/db/index");
  const { Repository } = await import("@/lib/db/repository");
  const db = getDb();
  const rows = db.prepare("SELECT id, period_end_date, status, claimed_at FROM widget_report_sends ORDER BY id").all() as Array<{ id: number; period_end_date: string | null; status: string; claimed_at: number | null }>;
  assert.deepEqual(rows.map((r) => r.period_end_date), ["2026-11-09", null, "2026-11-02", "2026-11-16"]);

  const index = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_widget_report_sends_date'").get();
  assert.ok(index, "the unique index exists even though two old rows share a date");

  const repo = new Repository(db);
  assert.equal(repo.getWidgetReportSendByDate(1, 7, "2026-11-09")!.status, "sent", "the period already sent is not sent again");
  // The row the old code left in 'sending' has no claimed_at: created_at decides when it is stale
  assert.equal(repo.retryWidgetReportSend(4, 15 * 60), false);
  db.prepare("UPDATE widget_report_sends SET created_at = unixepoch() - 3600 WHERE id = 4").run();
  assert.equal(repo.retryWidgetReportSend(4, 15 * 60), true);

  // Opening the same file again (a restart) changes nothing
  db.close();
  (global as unknown as { __db?: unknown }).__db = undefined;
  const again = getDb().prepare("SELECT period_end_date FROM widget_report_sends ORDER BY id").all() as Array<{ period_end_date: string | null }>;
  assert.deepEqual(again.map((r) => r.period_end_date), ["2026-11-09", null, "2026-11-02", "2026-11-16"]);
});
