/**
 * Calendly → widget_meetings sync (DIS-234).
 *
 * The widget opens the scheduling link in a new tab, so a booking happens outside it. Every
 * Calendly link the widget hands out carries utm_source=cs-widget (+ installation and session,
 * see withWidgetUtm), and Calendly stores those on the invitee's `tracking`. This sync lists the
 * organization's scheduled events, reads each new event's invitees once, and keeps the tagged
 * ones in widget_meetings. "Held" is derived: the event ended, is still active, and the invitee
 * was not marked no-show (Calendly has no explicit "held").
 *
 * Env: CALENDLY_API_TOKEN (PAT, needs scheduled_events:read at org level), CALENDLY_ORG
 * (organization URI or "organizations/<id>").
 */
import { Repository } from "@/lib/db/repository";
import { getDb, type WidgetMeeting, type WidgetMeetingStatus } from "@/lib/db/index";
import { WIDGET_UTM_SOURCE } from "@/lib/calendly";

const API = "https://api.calendly.com";

interface CalendlyEvent {
  uri: string;
  name: string | null;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
}

interface CalendlyInvitee {
  uri: string;
  email: string | null;
  name: string | null;
  status: "active" | "canceled";
  created_at: string;
  no_show: { uri: string } | null;
  tracking: { utm_source: string | null; utm_medium: string | null; utm_content: string | null } | null;
}

export interface MeetingSyncResult {
  configured: boolean;
  ok: boolean;
  eventsScanned: number;
  meetingsUpserted: number;
  error?: string;
}

export function isCalendlyConfigured(): boolean {
  return Boolean(process.env.CALENDLY_API_TOKEN && process.env.CALENDLY_ORG);
}

function orgUri(): string {
  const raw = (process.env.CALENDLY_ORG ?? "").trim().replace(/^\/+/, "");
  return raw.startsWith("https://") ? raw : `${API}/${raw}`;
}

async function calendlyGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Calendly ${res.status} on ${url.replace(API, "")}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function listAll<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page: { collection: T[]; pagination: { next_page: string | null } } = await calendlyGet(url);
    out.push(...page.collection);
    url = page.pagination?.next_page ?? null;
  }
  return out;
}

const toUnix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function installationFromMedium(medium: string | null): number | null {
  const m = medium?.match(/^installation-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function toMeetingRow(repo: Repository, event: CalendlyEvent, inv: CalendlyInvitee): Omit<WidgetMeeting, "id" | "synced_at"> {
  // utm_medium comes from a public URL: only keep it if it names a real installation (FK)
  const installationId = installationFromMedium(inv.tracking?.utm_medium ?? null);
  return {
    invitee_uri: inv.uri,
    event_uri: event.uri,
    installation_id: installationId != null && repo.getWidgetInstallationById(installationId) ? installationId : null,
    session_id: inv.tracking?.utm_content || null,
    invitee_email: inv.email?.toLowerCase() ?? null,
    invitee_name: inv.name,
    event_name: event.name,
    booked_at: toUnix(inv.created_at),
    start_time: toUnix(event.start_time),
    end_time: toUnix(event.end_time),
    event_status: event.status === "canceled" || inv.status === "canceled" ? "canceled" : "active",
    no_show: inv.no_show ? 1 : 0,
  };
}

export function meetingStatus(m: WidgetMeeting, now = Math.floor(Date.now() / 1000)): WidgetMeetingStatus {
  if (m.event_status === "canceled") return "canceled";
  if (m.no_show) return "no_show";
  return m.end_time <= now ? "held" : "scheduled";
}

/** Pull new widget-tagged bookings and refresh the state of open ones. Safe to run often. */
export async function syncWidgetMeetings(opts: { onLog?: (m: string) => void } = {}): Promise<MeetingSyncResult> {
  const log = opts.onLog ?? (() => {});
  if (!isCalendlyConfigured()) return { configured: false, ok: false, eventsScanned: 0, meetingsUpserted: 0 };

  const repo = new Repository(getDb());
  // Only bookings made after UTM tagging shipped can be traced, so start there.
  const since = Number(repo.getAppMeta("widget_tracking_v2_since") ?? Math.floor(Date.now() / 1000));
  const minStart = new Date((since - 86400) * 1000).toISOString();
  const maxStart = new Date(Date.now() + 120 * 86400 * 1000).toISOString();

  let eventsScanned = 0;
  let meetingsUpserted = 0;
  try {
    const params = new URLSearchParams({ organization: orgUri(), min_start_time: minStart, max_start_time: maxStart, count: "100" });
    const events = await listAll<CalendlyEvent>(`${API}/scheduled_events?${params}`);
    const byUri = new Map(events.map((e) => [e.uri, e]));

    for (const event of events) {
      if (repo.hasSeenCalendlyEvent(event.uri)) continue;
      const invitees = await listAll<CalendlyInvitee>(`${event.uri}/invitees?count=100`);
      for (const inv of invitees) {
        if (inv.tracking?.utm_source !== WIDGET_UTM_SOURCE) continue;
        repo.upsertWidgetMeeting(toMeetingRow(repo, event, inv));
        meetingsUpserted++;
      }
      repo.markCalendlyEventSeen(event.uri, toUnix(event.start_time));
      eventsScanned++;
    }

    // Refresh meetings that can still change (cancellations, no-show marks after the call)
    for (const m of repo.listOpenWidgetMeetings()) {
      const event = byUri.get(m.event_uri) ?? (await calendlyGet<{ resource: CalendlyEvent }>(m.event_uri)).resource;
      const inv = (await calendlyGet<{ resource: CalendlyInvitee }>(m.invitee_uri)).resource;
      repo.upsertWidgetMeeting(toMeetingRow(repo, event, inv));
    }

    repo.setAppMeta("calendly_last_sync", JSON.stringify({ at: Math.floor(Date.now() / 1000), ok: true }));
    log(`scanned ${eventsScanned} new events, ${meetingsUpserted} widget bookings`);
    return { configured: true, ok: true, eventsScanned, meetingsUpserted };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    repo.setAppMeta("calendly_last_sync", JSON.stringify({ at: Math.floor(Date.now() / 1000), ok: false, error }));
    log(`failed: ${error}`);
    return { configured: true, ok: false, eventsScanned, meetingsUpserted, error };
  }
}
