/**
 * Widget emails → HubSpot ticket status (DIS-234).
 *
 * A widget email (or a "Not helpful" follow-up request) reaches HubSpot as an inbound email to
 * the support inbox, and HubSpot's inbox automation turns it into a ticket. HubSpot gives us no
 * ticket id back on that path, and the ticket's subject is rewritten afterwards (to
 * "Company – Category – Product") and its contact reassigned, so neither can be searched. Two
 * things hold: the ticket is created within about a minute of the email, and the ticket's
 * incoming email keeps the footer the app writes (src/lib/widget-intake.ts): "Visitor email:",
 * "Widget session:" (since tracking v2) and "Submitted via the help widget". So this sync lists
 * the EMAIL-channel tickets created around each widget event (−2 / +10 min), keeps only those
 * whose incoming email has that footer, and picks by widget session, then visitor email, then
 * closest time. The link is stored in widget_hubspot_tickets.
 * Events sent on the CRM-ticket path carry the ticket id in their metadata and are read directly.
 * Open tickets are re-read hourly so the usage report can say whether a follow-up was handled.
 *
 * Env: HUBSPOT_ACCESS_TOKEN (tickets read scope).
 */
import { Repository } from "@/lib/db/repository";
import { getDb, type WidgetHubspotTicket } from "@/lib/db/index";

const API = "https://api.hubapi.com";
const LOOKBACK_SECONDS = 365 * 86400;
// Ticket createdate window around the widget event (observed: within a minute after it)
const MATCH_BEFORE_SECONDS = 2 * 60;
const MATCH_AFTER_SECONDS = 10 * 60;

interface HubspotEmail {
  id: string;
  properties: { hs_email_text?: string | null; hs_email_direction?: string | null; hs_email_subject?: string | null };
}

/** What the app's footer says on a ticket's incoming email (null when it has no widget footer). */
interface WidgetFooter { sessionId: string | null; visitorEmail: string | null; subject: string | null }

interface HubspotTicket {
  id: string;
  properties: { createdate?: string | null; closed_date?: string | null; subject?: string | null };
}

export interface TicketSyncResult {
  configured: boolean;
  ok: boolean;
  checked: number;
  matched: number;
  error?: string;
}

export function isHubspotTicketSyncConfigured(): boolean {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

/** Link to the ticket in HubSpot, when the portal id is known. */
export function hubspotTicketUrl(ticketId: string): string | null {
  const hub = process.env.NEXT_PUBLIC_HUBSPOT_HUB_ID;
  return hub ? `https://app.hubspot.com/contacts/${hub}/record/0-5/${ticketId}` : null;
}

const toUnix = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

async function hubspotCall<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // The search endpoint is limited to a few requests per second
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return res.json() as Promise<T>;
  }
}

/** Ticket state, plus what the visitor wrote when known (the incoming email's subject beats the ticket's, which HubSpot rewrites). */
function ticketRow(t: HubspotTicket, footer?: WidgetFooter | null) {
  const closedAt = toUnix(t.properties.closed_date);
  return {
    hubspot_ticket_id: t.id, status: (closedAt ? "closed" : "open") as WidgetHubspotTicket["status"], ticket_created_at: toUnix(t.properties.createdate), closed_at: closedAt,
    subject: footer?.subject ?? t.properties.subject?.trim() ?? "", visitor_email: footer?.visitorEmail ?? null,
  };
}

/** EMAIL-channel tickets created around one inbound widget email. */
async function ticketsNear(sentAt: number): Promise<HubspotTicket[]> {
  const data = await hubspotCall<{ results: HubspotTicket[] }>("/crm/v3/objects/tickets/search", {
    filterGroups: [{
      filters: [
        { propertyName: "createdate", operator: "BETWEEN", value: String((sentAt - MATCH_BEFORE_SECONDS) * 1000), highValue: String((sentAt + MATCH_AFTER_SECONDS) * 1000) },
        { propertyName: "source_type", operator: "EQ", value: "EMAIL" },
      ],
    }],
    properties: ["subject", "createdate", "closed_date"],
    sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
    limit: 20,
  });
  return data.results;
}

/** Read a ticket's incoming emails and parse the widget footer, if any. */
async function widgetFooterOf(ticketId: string): Promise<WidgetFooter | null> {
  const assoc = await hubspotCall<{ results?: Array<{ toObjectId: string | number }> }>(`/crm/v4/objects/tickets/${ticketId}/associations/emails`);
  const ids = (assoc.results ?? []).map((a) => String(a.toObjectId));
  if (ids.length === 0) return null;
  const data = await hubspotCall<{ results: HubspotEmail[] }>("/crm/v3/objects/emails/batch/read", {
    properties: ["hs_email_text", "hs_email_direction", "hs_email_subject"],
    inputs: ids.slice(0, 100).map((id) => ({ id })),
  });
  for (const e of data.results) {
    const text = e.properties.hs_email_text ?? "";
    if (e.properties.hs_email_direction !== "INCOMING_EMAIL" || !text.includes("Submitted via the help widget")) continue;
    return {
      sessionId: /Widget session: ([A-Za-z0-9-]{8,64})/.exec(text)?.[1] ?? null,
      // Mail clients turn the address into "x@y.com<mailto:x@y.com>": keep the address only
      visitorEmail: /Visitor email:\s*<?([A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(text)?.[1]?.toLowerCase() ?? null,
      subject: e.properties.hs_email_subject?.trim() || null,
    };
  }
  return null;
}

function metaOf(metadata: string | null): { visitorEmail: string | null; ticketId: string | null } {
  try {
    const m = metadata ? JSON.parse(metadata) as { visitorEmail?: unknown; ticketId?: unknown } : {};
    return {
      visitorEmail: typeof m.visitorEmail === "string" ? m.visitorEmail.toLowerCase() : null,
      ticketId: m.ticketId != null ? String(m.ticketId) : null,
    };
  } catch {
    return { visitorEmail: null, ticketId: null };
  }
}

const NOT_FOUND = { hubspot_ticket_id: null, status: "not_found" as const, ticket_created_at: null, closed_at: null };

/** Match new widget emails to HubSpot tickets and refresh the open ones. Safe to run often. */
export async function syncWidgetTickets(opts: { onLog?: (m: string) => void } = {}): Promise<TicketSyncResult> {
  const log = opts.onLog ?? (() => {});
  if (!isHubspotTicketSyncConfigured()) return { configured: false, ok: false, checked: 0, matched: 0 };

  const repo = new Repository(getDb());
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
  let checked = 0;
  let matched = 0;
  try {
    const candidates = repo.listWidgetTicketCandidates(since);
    const taken = repo.listLinkedHubspotTicketIds();

    // Known ticket id (already matched and still open, or sent on the CRM-ticket path): batch read
    const withId = candidates
      .map((c) => ({ ...c, knownId: c.ticket?.hubspot_ticket_id ?? metaOf(c.metadata).ticketId }))
      .filter((c): c is typeof c & { knownId: string } => !!c.knownId);
    for (let i = 0; i < withId.length; i += 100) {
      const chunk = withId.slice(i, i + 100);
      const data = await hubspotCall<{ results: HubspotTicket[] }>("/crm/v3/objects/tickets/batch/read", {
        properties: ["subject", "createdate", "closed_date"],
        inputs: chunk.map((c) => ({ id: c.knownId })),
      });
      const byId = new Map(data.results.map((t) => [t.id, t]));
      for (const c of chunk) {
        const t = byId.get(c.knownId);
        // The subject is read once per ticket (also for tickets linked before it was stored)
        const footer = t && c.ticket?.subject == null ? await widgetFooterOf(t.id) : null;
        // A ticket deleted in HubSpot no longer counts as handled or open
        repo.upsertWidgetHubspotTicket(c.event_id, t ? ticketRow(t, footer) : NOT_FOUND);
        if (t && !c.ticket) matched++;
        checked++;
      }
    }

    // Inbound emails not matched yet: EMAIL tickets created around each one whose incoming email
    // has the widget footer. Assigned in passes (same session, same visitor email, closest time)
    // so emails sent close together don't take each other's ticket.
    const known = new Set(withId.map((c) => c.event_id));
    const footers = new Map<string, WidgetFooter | null>();
    type Pending = (typeof candidates)[number] & { visitorEmail: string | null; near: Array<{ t: HubspotTicket; footer: WidgetFooter }> };
    const pending: Pending[] = [];
    for (const c of candidates.filter((x) => !known.has(x.event_id))) {
      const near: Pending["near"] = [];
      for (const t of await ticketsNear(c.created_at)) {
        if (taken.has(t.id)) continue;
        if (!footers.has(t.id)) footers.set(t.id, await widgetFooterOf(t.id));
        const footer = footers.get(t.id);
        if (footer) near.push({ t, footer });
      }
      pending.push({ ...c, visitorEmail: metaOf(c.metadata).visitorEmail, near });
    }
    const assigned = new Map<number, { t: HubspotTicket; footer: WidgetFooter }>();
    const gap = (t: HubspotTicket, at: number) => Math.abs((toUnix(t.properties.createdate) ?? 0) - at);
    const passes: Array<(c: Pending, f: WidgetFooter) => boolean> = [
      (c, f) => !!c.session_id && f.sessionId === c.session_id,
      (c, f) => !!c.visitorEmail && f.visitorEmail === c.visitorEmail,
      () => true,
    ];
    for (const pass of passes) {
      for (const c of pending.filter((x) => !assigned.has(x.event_id))) {
        const hit = c.near
          .filter((x) => !taken.has(x.t.id) && pass(c, x.footer))
          .sort((a, b) => gap(a.t, c.created_at) - gap(b.t, c.created_at))[0];
        if (hit) { assigned.set(c.event_id, hit); taken.add(hit.t.id); }
      }
    }
    for (const c of pending) {
      const hit = assigned.get(c.event_id);
      if (hit) matched++;
      repo.upsertWidgetHubspotTicket(c.event_id, hit ? ticketRow(hit.t, hit.footer) : NOT_FOUND);
      checked++;
    }

    repo.setAppMeta("hubspot_tickets_last_sync", JSON.stringify({ at: Math.floor(Date.now() / 1000), ok: true }));
    log(`checked ${checked} widget emails, matched ${matched} new tickets`);
    return { configured: true, ok: true, checked, matched };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    repo.setAppMeta("hubspot_tickets_last_sync", JSON.stringify({ at: Math.floor(Date.now() / 1000), ok: false, error }));
    log(`failed: ${error}`);
    return { configured: true, ok: false, checked, matched, error };
  }
}
