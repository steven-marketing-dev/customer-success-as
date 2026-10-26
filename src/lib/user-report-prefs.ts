import type { User } from "@/lib/db/index";
import { isValidTimezone } from "@/lib/widget-usage-report";

export interface ReportPrefsInput {
  email?: string | null;
  timezone?: string | null;
  report_7d?: boolean;
  report_30d?: boolean;
  report_90d?: boolean;
}

/** Validate the email-report fields of a profile update. Only fields present in `body` are returned. */
export function parseReportPrefs(body: Record<string, unknown>): { ok: true; prefs: ReportPrefsInput } | { ok: false; error: string } {
  const prefs: ReportPrefsInput = {};
  if (body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Invalid email address" };
    prefs.email = email || null;
  }
  if (body.timezone !== undefined) {
    const tz = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (tz && !isValidTimezone(tz)) return { ok: false, error: "Invalid timezone" };
    prefs.timezone = tz || null;
  }
  for (const key of ["report_7d", "report_30d", "report_90d"] as const) {
    if (body[key] !== undefined) prefs[key] = body[key] === true;
  }
  return { ok: true, prefs };
}

/** The email-report fields returned to the client. */
export function reportPrefsOf(user: User) {
  return {
    email: user.email,
    timezone: user.timezone,
    report_7d: user.report_7d === 1,
    report_30d: user.report_30d === 1,
    report_90d: user.report_90d === 1,
  };
}
