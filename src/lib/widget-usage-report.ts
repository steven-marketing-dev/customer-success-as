/**
 * Widget usage report (DIS-234): every 7, 30 and 90 days, per opted-in user, by email.
 *
 * Periods are exact 7/30/90-day windows of local calendar days, anchored at
 * WIDGET_REPORTS_ANCHOR (default 2026-11-02, a Monday) in the recipient's timezone. The
 * report covers every widget installation, with a per-installation breakdown, a summary,
 * a short detail section and a CSV with every record.
 */
import type { Repository } from "@/lib/db/repository";
import type { WidgetMeeting, WidgetHubspotTicket } from "@/lib/db/index";
import { isCalendlyConfigured, meetingStatus } from "@/lib/widget-meetings";
import { isHubspotTicketSyncConfigured, hubspotTicketUrl } from "@/lib/widget-tickets";

// discovered.ai design tokens (:root of the home redesign), inline for email clients
const LOGO_URL = "https://discovered.ai/wp-content/uploads/2022/04/dats-logo-updated.png";
const C = {
  teal: "#33b29c", teal700: "#1b8579", teal900: "#05635e", tealMuted: "#7cabad", tealPale: "#dcf0f3", aquaInk: "#d9f3ef",
  ink: "#233437", slate: "#5a7370", body: "#3f3f3f",
  ice: "#f2f5f7", mist: "#f7fafb", line: "#dce9e6", hero: "#f3f8fa",
  orange: "#ff9f2c", orangeEdge: "#c86a00", coral: "#fe5e5e",
};
const FONT = "'Poppins',system-ui,-apple-system,'Segoe UI',sans-serif";
const CARD_SHADOW = "0 2px 4px rgba(5,99,94,.04),0 18px 44px -18px rgba(5,99,94,.18)";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriodDays = (typeof REPORT_PERIODS)[number];
export const DEFAULT_REPORT_TIMEZONE = "America/Los_Angeles";

// ─── Timezone helpers (Intl only, no date library) ──────────────────────────

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock offset of `tz` at instant `utcMs`, in ms (local = utc + offset). */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

interface LocalDate { y: number; m: number; d: number }

function localDateOf(utcMs: number, tz: string): LocalDate {
  const local = new Date(utcMs + tzOffsetMs(utcMs, tz));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

function addDays(date: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/** Unix seconds of 00:00 local time on `date` in `tz` (DST-safe). */
function localMidnight(date: LocalDate, tz: string): number {
  const guess = Date.UTC(date.y, date.m - 1, date.d);
  let t = guess - tzOffsetMs(guess, tz);
  const second = tzOffsetMs(t, tz);
  if (guess - second !== t) t = guess - second;
  return Math.floor(t / 1000);
}

function parseAnchor(): LocalDate {
  const raw = process.env.WIDGET_REPORTS_ANCHOR ?? "2026-11-02";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { y: 2026, m: 11, d: 2 };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export interface ReportPeriod {
  days: number;
  start: number; // unix seconds, inclusive (local midnight)
  end: number; // unix seconds, exclusive (local midnight)
  timezone: string;
}

/** The most recent fully elapsed scheduled period, or null before the first one ends. */
export function latestCompletedPeriod(days: number, tz: string, nowMs = Date.now()): ReportPeriod | null {
  const anchor = parseAnchor();
  const today = localDateOf(nowMs, tz);
  const elapsed = daysBetween(anchor, today);
  const k = Math.floor(elapsed / days);
  if (k < 1) return null;
  const endDate = addDays(anchor, k * days);
  return { days, start: localMidnight(addDays(endDate, -days), tz), end: localMidnight(endDate, tz), timezone: tz };
}

/** The `days` whole local days before today (used by the preview, which ignores the anchor). */
export function trailingPeriod(days: number, tz: string, nowMs = Date.now()): ReportPeriod {
  const today = localDateOf(nowMs, tz);
  return { days, start: localMidnight(addDays(today, -days), tz), end: localMidnight(today, tz), timezone: tz };
}

export const MAX_CUSTOM_PERIOD_DAYS = 92;

/**
 * Local calendar days `from`..`to` (YYYY-MM-DD, both inclusive) in `tz`, for on-demand reports.
 * Returns an error string when the range is invalid, in the future or longer than 92 days.
 */
export function customPeriod(from: string, to: string, tz: string, nowMs = Date.now()): ReportPeriod | string {
  const parse = (v: string): LocalDate | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return null;
    const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    const check = addDays(date, 0);
    return check.y === date.y && check.m === date.m && check.d === date.d ? date : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return "Dates must be valid YYYY-MM-DD";
  const days = daysBetween(a, b) + 1;
  if (days < 1) return "The start date must be on or before the end date";
  if (days > MAX_CUSTOM_PERIOD_DAYS) return `The period can be at most ${MAX_CUSTOM_PERIOD_DAYS} days`;
  if (daysBetween(localDateOf(nowMs, tz), b) > 0) return "The end date can't be in the future";
  return { days, start: localMidnight(a, tz), end: localMidnight(addDays(b, 1), tz), timezone: tz };
}

/** Columns for the "by day" tables: one per day for 7-day reports, per week for 30, per 15 days for 90. */
interface Bucket { start: number; end: number; label: string }

function periodBuckets(period: ReportPeriod): { unit: string; buckets: Bucket[] } {
  const { start, end, days, timezone: tz } = period;
  const size = days <= 7 ? 1 : days <= 31 ? 7 : 15;
  const first = localDateOf(start * 1000, tz);
  const md = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const buckets: Bucket[] = [];
  for (let i = 0; i < days; i += size) {
    const bStart = localMidnight(addDays(first, i), tz);
    const bEnd = Math.min(localMidnight(addDays(first, Math.min(i + size, days)), tz), end);
    const label = size === 1
      ? new Date(bStart * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" }).replace(/^(\d+)\s+(\w+)$/, "$2 $1")
      : `${md(bStart)} – ${md(bEnd - 60)}`;
    buckets.push({ start: bStart, end: bEnd, label });
  }
  return { unit: size === 1 ? "day" : size === 7 ? "week" : "15 days", buckets };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmtDateTime(ts: number, tz: string): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtDate(ts: number, tz: string): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtIsoLocal(ts: number, tz: string): string {
  const off = tzOffsetMs(ts * 1000, tz);
  const local = new Date(ts * 1000 + off).toISOString().slice(0, 19);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off) / 60000;
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function tzShortName(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date(ts * 1000)).find((p) => p.type === "timeZoneName")?.value ?? "";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "45 min", "19 h", "3 days" */
function fmtDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  // Keep spreadsheet apps from evaluating visitor text as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Report data ────────────────────────────────────────────────────────────

export type QuestionOutcome = "resolved" | "follow_up" | "unknown";

const RATING_LABELS: Record<number, string> = { 1: "Not helpful", 2: "OK", 3: "Great" };

export interface WidgetUsageReport {
  subject: string;
  html: string;
  csv: string;
  csvFilename: string;
  summary: Record<string, number | null>;
}

export interface ReportOptions {
  /** Set for reports sent by hand (preview or "Send report now"): replaces the subscription footer. */
  sentBy?: string;
}

export function buildWidgetUsageReport(repo: Repository, period: ReportPeriod, opts: ReportOptions = {}): WidgetUsageReport {
  const { start, end, timezone: tz, days } = period;
  const raw = repo.getWidgetReportRecords(start, end);
  // A visitor who typed their email in the widget (email form or follow-up request) is named on
  // every record of that visit, not just the email itself
  const sessionEmails = repo.getWidgetSessionEmails([...new Set(
    [...raw.questions, ...raw.ratings, ...raw.events, ...raw.articleClicks].map((x) => x.session_id).filter((x): x is string => !!x),
  )]);
  const named = <T extends { session_id: string | null; user_email: string | null }>(xs: T[]): T[] =>
    xs.map((x) => (x.user_email || !x.session_id || !sessionEmails.has(x.session_id) ? x : { ...x, user_email: sessionEmails.get(x.session_id)! }));
  const r = { ...raw, questions: named(raw.questions), ratings: named(raw.ratings), events: named(raw.events), articleClicks: named(raw.articleClicks) };
  const since = repo.getWidgetDataSince();
  const trackingSince = Number(repo.getAppMeta("widget_tracking_v2_since") ?? 0) || null;
  const v2Partial = trackingSince == null || start < trackingSince;
  const v2Label = trackingSince ? fmtDate(trackingSince, tz) : "the launch date";
  const calendlyOn = isCalendlyConfigured();
  const now = Math.floor(Date.now() / 1000);

  const installName = new Map(r.installations.map((i) => [i.id, i.name]));
  const instLabel = (id: number | null) => (id != null ? installName.get(id) ?? `Installation ${id}` : "—");

  // Questions → outcome
  const ratingByExchange = new Map(r.sessionRatings.map((x) => [`${x.installation_id}:${x.exchange_id}`, x.rating]));
  const followUpsBySession = new Map<string, typeof r.sessionFollowUps>();
  for (const f of r.sessionFollowUps) {
    const list = followUpsBySession.get(f.session_id) ?? [];
    list.push(f);
    followUpsBySession.set(f.session_id, list);
  }
  // The email / booking that followed a question in the same visit (within 24h). A follow-up
  // request belongs only to the answer that was rated Not helpful. Questions from before sessions
  // existed take an email sent from the same network within the hour instead.
  const followUpOf = (q: (typeof r.questions)[number]): { event_id: number | null; kind: (typeof r.sessionFollowUps)[number]["kind"]; created_at: number } | null => {
    if (!q.session_id) {
      const f = r.ipFollowUps.find((x) => x.installation_id === q.installation_id && x.ip_hash === q.ip_hash &&
        x.created_at >= q.created_at && x.created_at < q.created_at + 3600);
      return f ? { event_id: f.event_id, kind: "email_submit", created_at: f.created_at } : null;
    }
    return (followUpsBySession.get(q.session_id) ?? []).find((f) =>
      f.created_at >= q.created_at && f.created_at < q.created_at + 86400 &&
      (f.kind !== "follow_up_request" || !f.exchange_id || f.exchange_id === q.exchange_id)) ?? null;
  };
  const outcomeOf = (q: (typeof r.questions)[number]): QuestionOutcome => {
    const rating = ratingByExchange.get(`${q.installation_id}:${q.exchange_id}`);
    if (q.status === "error" || q.status === "unanswered" || rating === 1) return "follow_up";
    if (followUpOf(q)) return "follow_up";
    if (rating === 2 || rating === 3) return "resolved";
    if (q.session_id) return "resolved";
    return "unknown";
  };
  const questions = r.questions.map((q) => ({ ...q, outcome: outcomeOf(q), rating: ratingByExchange.get(`${q.installation_id}:${q.exchange_id}`) ?? null, followUp: followUpOf(q) }));
  const outcomeCount = (o: QuestionOutcome) => questions.filter((q) => q.outcome === o).length;

  // KB usage: menu visits + article links opened from answers
  const kbMenu = r.events.filter((e) => e.event_type === "kb_click");
  const kbUnique = new Set([...kbMenu, ...r.articleClicks].map((x) => x.user_email ?? x.ip_hash)).size;
  const kbVisits = kbMenu.length + r.articleClicks.length;
  const kbVisitRows = [
    ...kbMenu.map((e) => ({ created_at: e.created_at, source: "Menu", title: null as string | null, url: null as string | null, user_email: e.user_email, account: e.account })),
    ...r.articleClicks.map((c) => ({ created_at: c.created_at, source: "Answer link", title: c.article_title, url: c.article_url, user_email: c.user_email, account: c.account })),
  ].sort((a, b) => a.created_at - b.created_at);

  // Emails sent: the email form plus "Not helpful" follow-up requests, each with its HubSpot ticket
  const hubspotOn = isHubspotTicketSyncConfigured();
  const emailEvents = r.events.filter((e) => e.event_type === "email_submit" || e.event_type === "follow_up_request");
  const tickets = repo.getWidgetHubspotTickets([
    ...emailEvents.map((e) => e.id),
    ...r.sessionFollowUps.map((f) => f.event_id).filter((x): x is number => x != null),
    ...r.ipFollowUps.map((f) => f.event_id),
  ]);
  const emails = emailEvents.map((e) => {
    let meta: { subject?: string; visitorEmail?: string } = {};
    try { meta = e.metadata ? JSON.parse(e.metadata) : {}; } catch { /* */ }
    return { ...e, subject: meta.subject ?? null, visitorEmail: meta.visitorEmail ?? e.user_email ?? null, ticket: tickets.get(e.id) ?? null };
  });
  const followUpRequests = emails.filter((e) => e.event_type === "follow_up_request").length;
  const ticketCount = (st: WidgetHubspotTicket["status"]) => emails.filter((e) => e.ticket?.status === st).length;

  // Ratings
  const ratingTotal = r.ratings.length;
  const ratingAvg = ratingTotal ? r.ratings.reduce((a, x) => a + x.rating, 0) / ratingTotal : null;
  const byRating = (n: number) => r.ratings.filter((x) => x.rating === n).length;

  // Meetings
  const calendlyClicks = r.events.filter((e) => e.event_type === "calendly_click").length;
  const meetingRows = new Map<string, WidgetMeeting>();
  for (const m of [...r.meetingsBooked, ...r.meetingsInPeriod]) meetingRows.set(m.invitee_uri, m);
  const meetings = [...meetingRows.values()].sort((a, b) => a.booked_at - b.booked_at);
  const held = r.meetingsInPeriod.filter((m) => meetingStatus(m, now) === "held").length;
  const meetingsAvailable = calendlyOn && !v2Partial;

  const summary: Record<string, number | null> = {
    meetings_booked: meetingsAvailable ? r.meetingsBooked.length : null,
    meetings_held: meetingsAvailable ? held : null,
    calendly_clicks: calendlyClicks,
    kb_unique_users: kbUnique,
    kb_visits: kbVisits,
    emails_sent: emails.length,
    follow_up_requests: followUpRequests,
    hubspot_tickets_closed: hubspotOn ? ticketCount("closed") : null,
    hubspot_tickets_open: hubspotOn ? ticketCount("open") : null,
    ratings: ratingTotal,
    rating_avg: ratingAvg,
    questions: questions.length,
    questions_resolved: outcomeCount("resolved"),
    questions_follow_up: outcomeCount("follow_up"),
    questions_unanswered: questions.filter((q) => q.status === "unanswered").length,
    questions_unknown: outcomeCount("unknown"),
  };

  // ─── Availability notes ───────────────────────────────────────────────────
  const notes: string[] = [];
  if (!calendlyOn) notes.push("Meetings booked/held: Not available — Calendly is not connected to the app yet.");
  else if (v2Partial) notes.push(`Meetings booked/held: Not available before ${v2Label}.`);
  if (v2Partial) {
    notes.push(`Email subject and widget sessions: Not available before ${v2Label}. Before then, a question counts as followed by an email only when the email came from the same network within the hour.`);
  }
  notes.push(`Account and user: only where the host page passes them to the widget${trackingSince ? `, since ${v2Label}` : ""}; older records show "—".`);
  const sourceNotes: Array<[string, number | null]> = [
    ["Questions", since.questions], ["Ratings", since.ratings], ["Article clicks", since.article_clicks],
    ["KB menu visits", since.kb_click], ["Emails sent", since.email_submit],
  ];
  for (const [label, t] of sourceNotes) {
    if (t != null && t > start) notes.push(`${label}: recorded since ${fmtDate(t, tz)}.`);
  }
  notes.push("Articles read after opening the knowledge base from the menu: Not available (external site).");
  notes.push(hubspotOn
    ? "HubSpot tickets: matched to each widget email by the time HubSpot created the ticket (within minutes of the email); the status is refreshed hourly."
    : "HubSpot ticket status: Not available — HubSpot is not connected to the app.");
  notes.push("Account / user also uses the email a visitor typed in the widget, for every record of that visit.");
  notes.push("Unique users are anonymous visitors (by browser network) unless the host page identifies the user.");
  notes.push("Needed follow-up = rated Not helpful, the answer failed, the agent said it had no documented guidance, or an email or meeting followed within 24 hours. Resolved = the other questions of a tracked session.");

  // ─── HTML ─────────────────────────────────────────────────────────────────
  const periodEndInclusive = end - 60;
  const header = `${esc(fmtDateTime(start, tz))} &nbsp;→&nbsp; ${esc(fmtDateTime(periodEndInclusive, tz))} &nbsp;·&nbsp; ${esc(tz)} (${esc(tzShortName(start, tz))})`;
  const td = (v: string, opts: { right?: boolean; muted?: boolean } = {}) =>
    `<td${opts.right ? ' align="right"' : ""} style="padding:9px 12px;border-top:1px solid ${C.line};vertical-align:top${opts.right ? ";white-space:nowrap" : ""}${opts.muted ? `;color:${C.slate}` : ""}">${v}</td>`;
  const th = (v: string, right = false) => `<th align="${right ? "right" : "left"}" style="padding:9px 12px;font-size:12px;font-weight:600;color:${C.ink}">${v}</th>`;
  const table = (head: string[], rows: string[][], rightCols: number[] = []) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:separate;border-spacing:0;border:1px solid ${C.line};border-radius:18px;overflow:hidden;color:${C.body}">
      <tr style="background:${C.ice}">${head.map((h, i) => th(h, rightCols.includes(i))).join("")}</tr>
      ${rows.map((row) => `<tr>${row.join("")}</tr>`).join("")}
    </table>`;
  const section = (title: string, body: string, hint = "") =>
    `<tr><td style="padding:30px 36px 0">
      <h2 style="font-size:19px;font-weight:600;letter-spacing:-.02em;color:${C.ink};margin:0 0 ${hint ? "4px" : "14px"}">${title}</h2>
      ${hint ? `<div style="font-size:13px;color:${C.slate};margin:0 0 14px">${hint}</div>` : ""}${body}</td></tr>`;
  const empty = (text: string) => `<div style="font-size:13px;color:${C.slate};background:${C.mist};border:1px solid ${C.line};border-radius:18px;padding:14px 18px">${text}</div>`;
  const more = (shown: number, total: number) => total > shown ? `<div style="font-size:12px;color:${C.slate};margin-top:6px">+${total - shown} more in the attached CSV.</div>` : "";
  const na = `<span style="color:${C.tealMuted}">Not available</span>`;
  const chip = (text: string, tone: "teal" | "coral" | "orange") => {
    const [bg, border, fg] = { teal: [C.tealPale, C.tealPale, C.teal900], coral: ["#ffffff", C.coral, C.ink], orange: ["#ffffff", C.orange, C.ink] }[tone];
    return `<span style="display:inline-block;background:${bg};border:1px solid ${border};color:${fg};font-size:12px;font-weight:500;border-radius:100px;padding:3px 12px;margin:0 6px 6px 0;white-space:nowrap">${text}</span>`;
  };
  const who = (email: string | null, account: string | null) => esc([account, email].filter(Boolean).join(" · ") || "—");

  const summaryRows: string[][] = [
    [td("Meetings booked"), td(meetingsAvailable ? `<strong>${r.meetingsBooked.length}</strong>` : na, { right: true }), td(`Scheduling link clicks: ${calendlyClicks}`, { muted: true })],
    [td("Meetings held"), td(meetingsAvailable ? `<strong>${held}</strong>` : na, { right: true }), td(meetingsAvailable ? `Held = ended, not canceled, not marked no-show` : "", { muted: true })],
    [td("KB — unique users"), td(`<strong>${kbUnique}</strong>`, { right: true }), td("", { muted: true })],
    [td("KB — total visits"), td(`<strong>${kbVisits}</strong>`, { right: true }), td(`${kbMenu.length} from the menu, ${r.articleClicks.length} from article links in answers`, { muted: true })],
    [td("Emails sent"), td(`<strong>${emails.length}</strong>`, { right: true }), td([
      followUpRequests ? `${followUpRequests} follow-up request${followUpRequests === 1 ? "" : "s"} after a Not helpful rating` : "",
      hubspotOn && emails.length ? `HubSpot: ${ticketCount("closed")} closed · ${ticketCount("open")} open${ticketCount("not_found") ? ` · ${ticketCount("not_found")} not found` : ""}` : "",
    ].filter(Boolean).join(" · "), { muted: true })],
    [td("Ratings"), td(`<strong>${ratingTotal}</strong>`, { right: true }), td(ratingTotal ? `Avg ${ratingAvg!.toFixed(2)} / 3 (Great ${byRating(3)} · OK ${byRating(2)} · Not helpful ${byRating(1)})` : "Average: —", { muted: true })],
    [td("Questions asked"), td(`<strong>${questions.length}</strong>`, { right: true }), td(`Resolved ${outcomeCount("resolved")} · Needed follow-up ${outcomeCount("follow_up")}${summary.questions_unanswered ? ` (agent had no documented answer: ${summary.questions_unanswered})` : ""} · Unknown ${outcomeCount("unknown")}`, { muted: true })],
  ];

  const perInstall = r.installations.map((i) => {
    const n = <T extends { installation_id: number | null }>(xs: T[]) => xs.filter((x) => x.installation_id === i.id).length;
    return [td(esc(i.name)), td(meetingsAvailable ? String(n(r.meetingsBooked)) : "—", { right: true }), td(String(n(kbMenu) + n(r.articleClicks)), { right: true }),
      td(String(n(emails)), { right: true }), td(String(n(r.ratings)), { right: true }), td(String(n(questions)), { right: true })];
  });

  // "By day" tables (one column per day / week / 15 days, depending on the report length)
  const { unit, buckets } = periodBuckets(period);
  const perBucket = (times: number[]) => buckets.map((b) => times.filter((t) => t >= b.start && t < b.end).length);
  const byDayTable = (rows: Array<[string, Array<number | string>]>) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:separate;border-spacing:0;border:1px solid ${C.line};border-radius:18px;overflow:hidden;color:${C.body}">
      <tr style="background:${C.ice}">${th("")}${buckets.map((b) => th(esc(b.label))).join("")}</tr>
      ${rows.map(([name, vals]) => `<tr>${td(`<span style="color:${C.slate};font-weight:600">${name}</span>`)}${vals.map((v) => td(v === 0 ? `<span style="color:${C.tealMuted}">0</span>` : `<strong>${v}</strong>`)).join("")}</tr>`).join("")}
    </table>`;
  const byUnitTitle = unit === "15 days" ? "per 15 days" : `by ${unit}`;
  const questionsByDay = byDayTable([["Questions", perBucket(questions.map((q) => q.created_at))]]);
  const notAvail = buckets.map(() => "—");
  const meetingsByDay = byDayTable([
    ["Booked", meetingsAvailable ? perBucket(r.meetingsBooked.map((m) => m.booked_at)) : notAvail],
    ["Held", meetingsAvailable ? perBucket(r.meetingsInPeriod.filter((m) => meetingStatus(m, now) === "held").map((m) => m.start_time)) : notAvail],
    ["Scheduling link clicks", perBucket(r.events.filter((e) => e.event_type === "calendly_click").map((e) => e.created_at))],
  ]);

  const meetingsBody = !meetingsAvailable
    ? empty(calendlyOn ? `Not available before ${esc(v2Label)}.` : "Not available — Calendly is not connected yet.")
    : meetings.length === 0 ? empty("No meetings booked through the widget in this period.")
    : table(["Booked on", "Meeting time", "Status", "Installation", "Account / user"], meetings.map((m) => [
      td(esc(fmtDateTime(m.booked_at, tz))), td(esc(fmtDateTime(m.start_time, tz))),
      td({ held: "Held", scheduled: "Upcoming", canceled: "Canceled", no_show: "No-show" }[meetingStatus(m, now)]),
      td(esc(instLabel(m.installation_id))), td(who(m.invitee_email, null)),
    ]));

  // HubSpot ticket state for a widget email: "Closed in 19 h" / "Open for 2 days" / "Not found"
  const ticketText = (t: WidgetHubspotTicket | null, sentAt: number) =>
    !t ? "Not checked yet"
    : t.status === "closed" ? `Closed in ${fmtDuration((t.closed_at ?? now) - sentAt)}`
    : t.status === "open" ? `Open for ${fmtDuration(now - sentAt)}`
    : "Not found in HubSpot";
  const ticketCell = (t: WidgetHubspotTicket | null, sentAt: number) => {
    const text = esc(ticketText(t, sentAt));
    const url = t?.hubspot_ticket_id ? hubspotTicketUrl(t.hubspot_ticket_id) : null;
    const color = t?.status === "closed" ? C.teal700 : t?.status === "open" ? C.orangeEdge : C.tealMuted;
    return url ? `<a href="${esc(url)}" style="color:${color}">${text}</a>` : `<span style="color:${color}">${text}</span>`;
  };

  const emailShown = emails.slice(0, 25);
  const emailsBody = emails.length === 0 ? empty("No emails sent through the widget in this period.")
    : table(["Sent", "Subject", "Account / user", ...(hubspotOn ? ["HubSpot ticket"] : [])], emailShown.map((e) => [
      td(esc(fmtDateTime(e.created_at, tz))), td(e.subject ? esc(truncate(e.subject, 120)) : na), td(who(e.visitorEmail, e.account)),
      ...(hubspotOn ? [td(ticketCell(e.ticket, e.created_at))] : []),
    ])) + more(emailShown.length, emails.length);

  const ratingsShown = r.ratings.slice(0, 25);
  const ratingsBody = r.ratings.length === 0 ? empty("No ratings in this period.")
    : table(["When", "Score", "Feedback", "Account / user"], ratingsShown.map((x) => [
      td(esc(fmtDateTime(x.created_at, tz))), td(`${x.rating} — ${RATING_LABELS[x.rating]}`),
      td(x.feedback ? `“${esc(truncate(x.feedback, 300))}”` : "—"), td(who(x.user_email, x.account)),
    ])) + more(ratingsShown.length, r.ratings.length);

  const kbShown = kbVisitRows.slice(0, 25);
  const kbBody = kbVisitRows.length === 0 ? empty("No knowledge base visits from the widget in this period.")
    : table(["When", "From", "Article", "Account / user"], kbShown.map((v) => [
      td(esc(fmtDateTime(v.created_at, tz))), td(v.source),
      td(v.url ? `<a href="${esc(v.url)}" style="color:${C.teal700}">${esc(v.title ?? v.url)}</a>` : `<span style="color:${C.slate}">Knowledge base home (article not trackable)</span>`),
      td(who(v.user_email, v.account)),
    ])) + more(kbShown.length, kbVisitRows.length);

  const followUps = questions.filter((q) => q.outcome === "follow_up");
  const followUpReasons = (q: (typeof questions)[number]) => {
    const kind = q.followUp?.kind;
    return [
      q.status === "error" ? chip("Answer failed", "coral") : "",
      q.status === "unanswered" ? chip("No documented answer", "coral") : "",
      q.rating === 1 ? chip("Rated Not helpful", "orange") : "",
      kind === "follow_up_request" ? chip("Asked to be contacted", "orange") : kind === "email_submit" ? chip("Emailed support", "teal") : kind === "meeting" ? chip("Booked a meeting", "teal") : "",
    ].join("");
  };
  // Whether anyone picked it up: the HubSpot ticket of the email that followed, if any
  const followUpStatus = (q: (typeof questions)[number]) => {
    const f = q.followUp;
    let line: string;
    if (f?.kind === "meeting") line = `<span style="color:${C.teal700};font-weight:600">Meeting booked</span>`;
    else if (f?.event_id != null) line = hubspotOn ? `HubSpot ticket · <strong>${ticketCell(tickets.get(f.event_id) ?? null, f.created_at)}</strong>` : "Emailed support";
    else line = `<span style="color:${C.tealMuted}">No contact details left</span>`;
    return `<div style="margin-top:10px;font-size:12px;color:${C.slate}">${line}</div>`;
  };
  const followShown = followUps.slice(0, 15);
  const questionsBody = (followUps.length === 0
    ? empty("No questions needed follow-up in this period.")
    : followShown.map((q) => `
      <div style="border:1px solid ${C.line};border-radius:18px;padding:16px 18px;margin-bottom:12px;font-size:13px;background:#ffffff;box-shadow:${CARD_SHADOW}">
        <div>${followUpReasons(q)}</div>
        <div style="color:${C.slate};font-size:12px;margin-top:2px">${esc(fmtDateTime(q.created_at, tz))} · ${esc(instLabel(q.installation_id))} · ${who(q.user_email, q.account)}</div>
        <div style="margin-top:8px;color:${C.ink};font-weight:600;font-size:14px">${esc(truncate(q.question, 500))}</div>
        ${q.answer ? `<div style="margin-top:8px;color:${C.body};font-size:12px;background:${C.mist};border-radius:12px;padding:10px 14px"><span style="color:${C.teal700};font-weight:600">Agent:</span> ${esc(truncate(q.answer, 400))}</div>` : ""}
        ${followUpStatus(q)}
      </div>`).join("") + more(followShown.length, followUps.length))
    + `<div style="font-size:12px;color:${C.slate};margin-top:6px">All ${questions.length} questions, with full text and the agent's answers, are in the attached CSV.</div>`;

  const label = days === 7 ? "7-day" : days === 30 ? "30-day" : `${days}-day`;
  // Stat band like the home page's "Proven impact" band: deep teal gradient, white numbers
  const kpi = (value: string, labelText: string, note: string) =>
    `<td width="25%" valign="top" style="padding:0 8px">
      <div style="font-size:34px;font-weight:600;letter-spacing:-.02em;color:#ffffff;line-height:1.1">${value}</div>
      <div style="font-size:13px;font-weight:600;color:#ffffff;margin-top:6px">${labelText}</div>
      <div style="font-size:12px;color:${C.aquaInk};margin-top:2px">${note}</div></td>`;
  const kpis = `<tr><td style="padding:0 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.teal900}" style="background:${C.teal900};background-image:linear-gradient(100deg,${C.teal700} 0%,${C.teal900} 100%);border-radius:18px"><tr><td style="padding:24px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpi(String(questions.length), "Questions", `${outcomeCount("resolved")} resolved`)}
    ${kpi(String(outcomeCount("follow_up")), "Need follow-up", summary.questions_unanswered ? `${summary.questions_unanswered} with no documented answer` : "&nbsp;")}
    ${kpi(String(emails.length), "Emails to support", hubspotOn && emails.length ? `${ticketCount("closed")} closed in HubSpot` : "&nbsp;")}
    ${kpi(meetingsAvailable ? String(r.meetingsBooked.length) : "—", "Meetings booked", `${calendlyClicks} link clicks`)}
    </tr></table></td></tr></table></td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="light" />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" /><title>CS widget usage report</title></head>
<body style="margin:0;padding:28px 12px;background:${C.mist};font-family:${FONT};color:${C.body};font-size:14px;line-height:1.55">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:700px;margin:0 auto;background:#ffffff;border:1px solid ${C.line};border-radius:28px;overflow:hidden;box-shadow:${CARD_SHADOW}">
<tr><td style="padding:22px 36px;border-bottom:1px solid ${C.line}">
  <img src="${LOGO_URL}" width="150" height="27" alt="Discovered" style="display:block;border:0" />
</td></tr>
<tr><td bgcolor="${C.hero}" style="background:${C.hero};padding:30px 36px 34px">
  <div style="font-size:20px;font-weight:600;color:${C.ink}">Customer Success Agent</div>
  <h1 style="font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1.15;color:${C.teal700};margin:4px 0 10px">Widget usage report</h1>
  <div style="font-size:14px;color:${C.body}">${label} period · ${header}</div>
</td></tr>
<tr><td style="height:28px;font-size:0;line-height:0">&nbsp;</td></tr>
${kpis}
${section("Questions needing follow-up", questionsBody, "Questions the agent couldn't answer, rated Not helpful, or followed by an email or meeting.")}
${section("Summary", table(["Metric", "Value", "Note"], summaryRows, [1]), `All widget installations (${r.installations.length}). Every record is in the attached ${esc(csvFilenameFor(period, tz))}.`)}
${r.installations.length > 1 ? section("By installation", table(["Installation", "Meetings", "KB visits", "Emails", "Ratings", "Questions"], perInstall, [1, 2, 3, 4, 5])) : ""}
${section(`Questions ${byUnitTitle}`, questionsByDay)}
${section(`Meetings ${byUnitTitle}`, meetingsByDay)}
${section("Meetings", meetingsBody)}
${section("Ratings", ratingsBody)}
${section("Emails sent", emailsBody)}
${section("Knowledge base visits", kbBody)}
<tr><td style="padding:30px 36px 34px">
  <div style="background:${C.ice};border-radius:18px;padding:18px 22px">
    <div style="font-size:15px;font-weight:600;color:${C.ink};margin-bottom:8px">Data availability</div>
    <ul style="font-size:12px;color:${C.slate};margin:0;padding-left:18px">${notes.map((n) => `<li style="margin-bottom:4px">${esc(n)}</li>`).join("")}</ul>
  </div>
</td></tr>
<tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:20px 36px;font-size:12px;color:${C.aquaInk}">
  <strong style="color:#ffffff">Discovered</strong> · Customer Success Agent<br />${opts.sentBy
    ? `Sent on demand by ${esc(opts.sentBy)}. It is not part of the scheduled reports.`
    : `You receive this because the ${label} report is on in your profile (My Profile → Email reports).`}
</td></tr>
</table>
</body></html>`;

  // ─── CSV (every record) ───────────────────────────────────────────────────
  const head = ["record_type", "timestamp_local", "timestamp_utc", "installation", "account", "user", "session_id",
    "title_or_subject", "question", "answer", "rating", "feedback", "status", "url", "meeting_start_local", "hubspot_ticket_id", "hubspot_ticket_status"];
  const rows: Array<Array<string | number | null>> = [];
  const base = (type: string, ts: number, inst: number | null, account: string | null, user: string | null, session: string | null) =>
    [type, fmtIsoLocal(ts, tz), new Date(ts * 1000).toISOString(), instLabel(inst), account, user, session];
  for (const m of meetings) rows.push([...base("meeting", m.booked_at, m.installation_id, null, m.invitee_email, m.session_id), m.event_name, null, null, null, null, meetingStatus(m, now), null, fmtIsoLocal(m.start_time, tz)]);
  for (const e of kbMenu) rows.push([...base("kb_visit_menu", e.created_at, e.installation_id, e.account, e.user_email, e.session_id), null, null, null, null, null, null, e.source_url, null]);
  for (const c of r.articleClicks) rows.push([...base("kb_visit_article", c.created_at, c.installation_id, c.account, c.user_email, c.session_id), c.article_title, null, null, null, null, null, c.article_url, null]);
  const csvTicket = (t: WidgetHubspotTicket | null | undefined) => (hubspotOn ? [t?.hubspot_ticket_id ?? null, t?.status ?? "not_checked"] : [null, null]);
  for (const e of emails) rows.push([...base(e.event_type === "follow_up_request" ? "follow_up_request" : "email_sent", e.created_at, e.installation_id, e.account, e.visitorEmail, e.session_id), e.subject ?? "Not available", null, null, null, null, null, e.source_url, null, ...csvTicket(e.ticket)]);
  for (const x of r.ratings) rows.push([...base("rating", x.created_at, x.installation_id, x.account, x.user_email, x.session_id), null, x.question, x.answer, x.rating, x.feedback, null, null, null]);
  for (const q of questions) rows.push([...base("question", q.created_at, q.installation_id, q.account, q.user_email, q.session_id), null, q.question, q.answer, q.rating, null, q.outcome, null, null,
    ...(q.followUp?.event_id != null ? csvTicket(tickets.get(q.followUp.event_id)) : [null, null])]);
  for (const e of r.events.filter((x) => x.event_type === "calendly_click")) rows.push([...base("scheduling_link_click", e.created_at, e.installation_id, e.account, e.user_email, e.session_id), null, null, null, null, null, null, e.source_url, null]);
  for (const row of rows) while (row.length < head.length) row.push(null);
  rows.sort((a, b) => String(a[2]).localeCompare(String(b[2])));
  const csv = "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

  const range = `${new Date(start * 1000).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })} – ${new Date(periodEndInclusive * 1000).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" })}`;
  return {
    subject: `CS widget usage report — ${label} (${range})`,
    html,
    csv,
    csvFilename: csvFilenameFor(period, tz),
    summary,
  };
}

function csvFilenameFor(period: ReportPeriod, tz: string): string {
  const d = (ts: number) => fmtIsoLocal(ts, tz).slice(0, 10);
  return `widget-report-${d(period.start)}_${d(period.end - 60)}.csv`;
}
