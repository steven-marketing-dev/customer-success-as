import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { buildWidgetUsageReport, trailingPeriod, REPORT_PERIODS } from "@/lib/widget-usage-report";
import { sendWidgetReport, userReportTimezone } from "@/lib/widget-report-scheduler";
import { syncWidgetMeetings, isCalendlyConfigured } from "@/lib/widget-meetings";
import { isReportEmailConfigured } from "@/lib/email/reports";
import { syncWidgetTickets } from "@/lib/widget-tickets";

/**
 * Master-only preview of the widget usage report for the last N whole days in the caller's
 * timezone. GET returns the HTML (open it in a tab); POST emails it to the caller only.
 * Previews never touch widget_report_sends, so they don't consume a scheduled period.
 */
function gate(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (session.role !== "master") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const repo = new Repository(getDb());
  const user = repo.getUserById(session.userId);
  if (!user) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  return { repo, user };
}

function parseDays(v: unknown): number {
  const n = Number(v);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? n : 7;
}

export async function GET(req: NextRequest) {
  const g = gate(req);
  if ("error" in g) return g.error;
  const days = parseDays(new URL(req.url).searchParams.get("days"));
  const report = buildWidgetUsageReport(g.repo, trailingPeriod(days, userReportTimezone(g.user)));
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(report.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report.csvFilename}"` },
    });
  }
  return new Response(report.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  const g = gate(req);
  if ("error" in g) return g.error;
  if (!g.user.email) return NextResponse.json({ error: "Set your email in My Profile first" }, { status: 400 });
  if (!isReportEmailConfigured()) return NextResponse.json({ error: "SendGrid / REPORTS_FROM is not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { days?: number; syncMeetings?: boolean };
  const days = parseDays(body.days);
  const meetingSync = body.syncMeetings && isCalendlyConfigured() ? await syncWidgetMeetings() : null;
  if (body.syncMeetings) await syncWidgetTickets().catch(() => null);
  try {
    await sendWidgetReport(g.repo, g.user, trailingPeriod(days, userReportTimezone(g.user)), { sentBy: g.user.display_name || g.user.username });
    return NextResponse.json({ ok: true, to: g.user.email, days, meetingSync });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), meetingSync }, { status: 502 });
  }
}
