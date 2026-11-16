/**
 * Widget usage report job (DIS-234). Runs inside the server process (see instrumentation-node.ts).
 *
 * Every hour: for each user with an email and at least one report on, find the most recent
 * completed 7/30/90-day period in their timezone and send it once. widget_report_sends has
 * UNIQUE(user, length, period_end) and the row is claimed before sending, so restarts or a
 * double tick never send the same period twice. Failures retry on the next ticks (max 3).
 * Only periods that ended in the last 48h are sent: turning a report on mid-cycle waits for
 * the next period instead of mailing an old one.
 *
 * Each tick also links widget emails to their HubSpot tickets (src/lib/widget-tickets.ts).
 *
 * WIDGET_REPORTS_ENABLED=1 turns it on (off by default; set 0 to stop it without a redeploy).
 */
import { Repository } from "@/lib/db/repository";
import { getDb, localDateString, type User } from "@/lib/db/index";
import { acquireJob, releaseJob } from "@/lib/locks";
import { syncWidgetMeetings, isCalendlyConfigured } from "@/lib/widget-meetings";
import { syncWidgetTickets } from "@/lib/widget-tickets";
import {
  REPORT_PERIODS, DEFAULT_REPORT_TIMEZONE, buildWidgetUsageReport, latestCompletedPeriod, isValidTimezone,
  type ReportPeriod, type ReportOptions,
} from "@/lib/widget-usage-report";
import { sendReportEmail, isReportEmailConfigured } from "@/lib/email/reports";

const TICK_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const SEND_WINDOW_SECONDS = 48 * 3600;
const MEETING_SYNC_EVERY_SECONDS = 6 * 3600;
// A row still 'sending' after this long means the process died mid-send (a deploy restarts the
// container): it is retried like a failure. The email may then arrive twice; a lost report is worse.
export const STALE_SENDING_SECONDS = 15 * 60;

export function userReportTimezone(user: Pick<User, "timezone">): string {
  return user.timezone && isValidTimezone(user.timezone) ? user.timezone : DEFAULT_REPORT_TIMEZONE;
}

function enabledPeriods(user: User): number[] {
  return REPORT_PERIODS.filter((d) => (d === 7 ? user.report_7d : d === 30 ? user.report_30d : user.report_90d) === 1);
}

/** Build one user's report for `period` and email it to their address. */
export async function sendWidgetReport(repo: Repository, user: User, period: ReportPeriod, opts: ReportOptions = {}): Promise<void> {
  if (!user.email) throw new Error(`User ${user.id} has no email`);
  const report = buildWidgetUsageReport(repo, period, opts);
  await sendReportEmail({
    to: user.email,
    subject: report.subject,
    html: report.html,
    attachments: [{ filename: report.csvFilename, content: report.csv, type: "text/csv" }],
  });
}

async function maybeSyncMeetings(repo: Repository, force: boolean, log: (m: string) => void): Promise<void> {
  if (!isCalendlyConfigured()) return;
  let lastAt = 0;
  try { lastAt = JSON.parse(repo.getAppMeta("calendly_last_sync") ?? "{}").at ?? 0; } catch { /* */ }
  if (!force && Math.floor(Date.now() / 1000) - lastAt < MEETING_SYNC_EVERY_SECONDS) return;
  await syncWidgetMeetings({ onLog: (m) => log(`[calendly] ${m}`) });
}

export async function runWidgetReportsTick(log: (m: string) => void = console.log): Promise<void> {
  // The lock is on `global`: the scheduled tick and a route may load separate copies of this module
  if (!acquireJob("widget-reports")) return;
  try {
    const repo = new Repository(getDb());
    const now = Math.floor(Date.now() / 1000);
    repo.setAppMeta("widget_reports_last_tick", String(now));

    const due: Array<{ user: User; period: ReportPeriod; endDate: string; retryId: number | null }> = [];
    for (const user of repo.listUsersWithWidgetReports()) {
      const tz = userReportTimezone(user);
      for (const days of enabledPeriods(user)) {
        const period = latestCompletedPeriod(days, tz);
        if (!period || now - period.end > SEND_WINDOW_SECONDS) continue;
        // The period is identified by the local date it ended on, so changing the timezone
        // (which moves `period.end` by a few hours) does not send the same report again
        const endDate = localDateString(period.end, tz);
        const existing = repo.getWidgetReportSendByDate(user.id, days, endDate);
        if (!existing) { due.push({ user, period, endDate, retryId: null }); continue; }
        const stale = existing.status === "sending" && now - (existing.claimed_at ?? existing.created_at) >= STALE_SENDING_SECONDS;
        if (existing.status !== "failed" && !stale) continue;
        if (existing.attempts < MAX_ATTEMPTS) due.push({ user, period, endDate, retryId: existing.id });
        else if (stale) {
          repo.finishWidgetReportSend(existing.id, false, "Interrupted while sending (process restarted); no attempts left");
          console.error(`[widget-reports] ERROR: ${days}d report to user ${user.id} was interrupted and has no attempts left; send it with "Send report now"`);
        }
      }
    }

    await maybeSyncMeetings(repo, due.length > 0, log);
    // Hourly: match new widget emails to HubSpot tickets and refresh open ones (no-op without a token)
    await syncWidgetTickets({ onLog: (m) => log(`[hubspot-tickets] ${m}`) });
    if (due.length === 0) return;
    if (!isReportEmailConfigured()) {
      console.error(`[widget-reports] ERROR: ${due.length} report(s) due but SendGrid/REPORTS_FROM is not configured; nothing was sent`);
      return;
    }

    for (const { user, period, endDate, retryId } of due) {
      const claimed = retryId != null
        ? repo.retryWidgetReportSend(retryId, STALE_SENDING_SECONDS)
        : repo.claimWidgetReportSend(user.id, period.days, period.start, period.end, endDate);
      if (!claimed) continue;
      const row = repo.getWidgetReportSendByDate(user.id, period.days, endDate)!;
      try {
        await sendWidgetReport(repo, user, period);
        repo.finishWidgetReportSend(row.id, true, null);
        log(`[widget-reports] sent ${period.days}d report to user ${user.id}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        repo.finishWidgetReportSend(row.id, false, error.slice(0, 1000));
        console.error(`[widget-reports] ${period.days}d report to user ${user.id} failed (attempt ${row.attempts}):`, error);
        if (row.attempts >= MAX_ATTEMPTS) {
          console.error(`[widget-reports] ERROR: ${period.days}d report to user ${user.id} gave up after ${MAX_ATTEMPTS} attempts; send it with "Send report now"`);
        }
      }
    }
  } catch (err) {
    console.error("[widget-reports] tick failed:", err);
  } finally {
    releaseJob("widget-reports");
  }
}

/**
 * With the job off, say so loudly if someone is waiting for reports (DIS-358: the first weekly
 * report was skipped silently because the variable was never set in Coolify).
 */
function warnIfReportsExpected(): void {
  let recipients = 0;
  try {
    recipients = new Repository(getDb()).listUsersWithWidgetReports().length;
  } catch (err) {
    console.error("[widget-reports] disabled, and could not check for recipients:", err);
    return;
  }
  if (recipients > 0) {
    console.error(
      `[widget-reports] ERROR: disabled (WIDGET_REPORTS_ENABLED != 1) but ${recipients} user(s) have reports on; ` +
      "no scheduled report will be sent. Set WIDGET_REPORTS_ENABLED=1 and redeploy."
    );
  } else {
    console.log("[widget-reports] disabled (WIDGET_REPORTS_ENABLED != 1)");
  }
}

export function scheduleWidgetReports() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.WIDGET_REPORTS_ENABLED !== "1") {
    warnIfReportsExpected();
    return;
  }
  const tick = () => { void runWidgetReportsTick(); };
  // First tick a few minutes after boot, then hourly
  setTimeout(tick, 5 * 60 * 1000);
  setInterval(tick, TICK_MS);
  console.log("[widget-reports] scheduled hourly");
}
