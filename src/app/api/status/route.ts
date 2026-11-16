import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { getSessionFromRequest } from "@/lib/auth";
import { getJobState } from "@/lib/jobRunner";
import { runningJobs } from "@/lib/locks";
import { isProductFruitsConfigured } from "@/lib/productFruits";
import { isReportEmailConfigured } from "@/lib/email/reports";
import { STALE_SENDING_SECONDS } from "@/lib/widget-report-scheduler";

export const dynamic = "force-dynamic";

/**
 * What the app is doing, for people, agents and monitors (DIS-412): which commit is serving,
 * whether the schema is applied, which jobs are running, and how the last pipeline run, KB sync
 * and widget reports went. No customer data, names or emails.
 *
 * Auth: the session cookie, or `x-api-key` = N8N_API_KEY (same key as /api/agent/answer).
 * The path is public in middleware.ts, so the cookie is verified here and not read from headers.
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.N8N_API_KEY;
  const byKey = !!apiKey && req.headers.get("x-api-key") === apiKey;
  if (!byKey) {
    const session = await getSessionFromRequest(req).catch(() => null);
    const exists = session && getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(session.userId);
    if (!exists) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Opening the DB applies the schema, so reaching this point means it is in place
  const repo = new Repository(getDb());
  const now = Math.floor(Date.now() / 1000);
  const parse = (key: string): Record<string, unknown> | null => {
    try { return JSON.parse(repo.getAppMeta(key) ?? "null"); } catch { return null; }
  };
  const job = getJobState();
  const sync = repo.getSyncState();
  const lastTick = Number(repo.getAppMeta("widget_reports_last_tick") ?? 0) || null;
  const reportsEnabled = process.env.WIDGET_REPORTS_ENABLED === "1";
  const recipients = repo.listUsersWithWidgetReports().length;
  const problems = repo.countWidgetReportProblems(now - 7 * 86400, STALE_SENDING_SECONDS);

  const warnings: string[] = [];
  if (recipients > 0 && !reportsEnabled) warnings.push("Widget reports are off (WIDGET_REPORTS_ENABLED != 1) but users expect them");
  if (recipients > 0 && reportsEnabled && !isReportEmailConfigured()) warnings.push("Widget reports are on but SendGrid / REPORTS_FROM is not configured");
  if (problems.failed > 0) warnings.push(`${problems.failed} widget report(s) failed in the last 7 days`);
  if (problems.stuck > 0) warnings.push(`${problems.stuck} widget report(s) stuck in 'sending'`);
  const kbLast = parse("kb_sync_last");
  if (kbLast && kbLast.ok === false) warnings.push("The last KB sync failed");

  return NextResponse.json({
    ok: warnings.length === 0,
    warnings,
    commit: process.env.GIT_SHA || null,
    now,
    schema: { applied: true, widget_tracking_v2_since: Number(repo.getAppMeta("widget_tracking_v2_since") ?? 0) || null },
    running: runningJobs().map((j) => ({ name: j.name, since: Math.floor(j.since / 1000) })),
    pipeline: {
      // In memory: "idle" after a restart, even if a run was interrupted
      status: job.status,
      mode: job.mode,
      started_at: job.startedAt ? Math.floor(job.startedAt / 1000) : null,
      completed_at: job.completedAt ? Math.floor(job.completedAt / 1000) : null,
      last_sync_at: sync.last_sync_at,
      last_run_at: sync.last_run_at,
      unprocessed_tickets: repo.getUnprocessedTickets().length,
    },
    kb_sync: {
      configured: isProductFruitsConfigured(),
      interval_hours: Number(process.env.KB_SYNC_INTERVAL_HOURS ?? "6"),
      last: kbLast,
      articles: repo.countKBArticles(),
    },
    widget_reports: {
      enabled: reportsEnabled,
      email_configured: isReportEmailConfigured(),
      recipients,
      last_tick_at: lastTick,
      failed_last_7d: problems.failed,
      stuck_sending: problems.stuck,
      hubspot_tickets_last_sync: parse("hubspot_tickets_last_sync"),
      calendly_last_sync: parse("calendly_last_sync"),
    },
  });
}
