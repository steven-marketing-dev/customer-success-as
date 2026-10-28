import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { customPeriod, trailingPeriod, REPORT_PERIODS } from "@/lib/widget-usage-report";
import { sendWidgetReport, userReportTimezone } from "@/lib/widget-report-scheduler";
import { syncWidgetMeetings, isCalendlyConfigured } from "@/lib/widget-meetings";
import { isReportEmailConfigured } from "@/lib/email/reports";

const MAX_RECIPIENTS = 25;

/**
 * Master-only "Send report now": emails the widget usage report to the chosen users right away,
 * for the last 7/30/90 days or for custom dates, each in the recipient's timezone.
 * Body: { userIds: number[], days?: 7|30|90, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }.
 * Never touches widget_report_sends, so the scheduled reports still go out as usual.
 */
export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.role !== "master") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isReportEmailConfigured()) return NextResponse.json({ error: "SendGrid / REPORTS_FROM is not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { userIds?: unknown; days?: unknown; from?: unknown; to?: unknown };
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (ids.length === 0) return NextResponse.json({ error: "Choose at least one recipient" }, { status: 400 });
  if (ids.length > MAX_RECIPIENTS) return NextResponse.json({ error: `At most ${MAX_RECIPIENTS} recipients at a time` }, { status: 400 });

  const custom = body.from != null || body.to != null;
  const days = Number(body.days);
  if (custom && (typeof body.from !== "string" || typeof body.to !== "string")) {
    return NextResponse.json({ error: "Both dates are required" }, { status: 400 });
  }
  if (!custom && !(REPORT_PERIODS as readonly number[]).includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90" }, { status: 400 });
  }

  const repo = new Repository(getDb());
  const sender = repo.getUserById(session.userId);
  const users = ids.map((id) => ({ id, user: repo.getUserById(id) }));
  const missing = users.filter((u) => !u.user).map((u) => u.id);
  if (missing.length) return NextResponse.json({ error: `Unknown user(s): ${missing.join(", ")}` }, { status: 400 });
  const noEmail = users.filter((u) => !u.user!.email).map((u) => u.user!.display_name || u.user!.username);
  if (noEmail.length) return NextResponse.json({ error: `No report email set for: ${noEmail.join(", ")}` }, { status: 400 });

  // Validate the custom range up front (in each recipient's timezone) so nothing is sent on a bad request
  const periods = new Map<number, ReturnType<typeof trailingPeriod>>();
  for (const { user } of users) {
    const tz = userReportTimezone(user!);
    const period = custom ? customPeriod(body.from as string, body.to as string, tz) : trailingPeriod(days, tz);
    if (typeof period === "string") return NextResponse.json({ error: period }, { status: 400 });
    periods.set(user!.id, period);
  }

  const meetingSync = isCalendlyConfigured() ? await syncWidgetMeetings().catch(() => null) : null;
  const sentBy = sender?.display_name || sender?.username || "an admin";
  const results: Array<{ userId: number; to: string; ok: boolean; error?: string }> = [];
  for (const { user } of users) {
    try {
      await sendWidgetReport(repo, user!, periods.get(user!.id)!, { sentBy });
      results.push({ userId: user!.id, to: user!.email!, ok: true });
    } catch (err) {
      results.push({ userId: user!.id, to: user!.email!, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.log(`[widget-reports] on-demand report by user ${session.userId}: ${results.filter((r) => r.ok).length}/${results.length} sent`);
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, results, meetingSync }, { status: failed === results.length ? 502 : 200 });
}
