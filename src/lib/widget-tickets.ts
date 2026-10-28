/**
 * Widget emails → HubSpot ticket status (DIS-234).
 *
 * A widget email (or a "Not helpful" follow-up request) reaches HubSpot as an inbound email to
 * the support inbox, and HubSpot's inbox automation turns it into a ticket. HubSpot gives us no
 * ticket id back on that path, so this sync finds the ticket by its subject (the one the widget
 * sent) created within a few hours of the widget event, and stores it in widget_hubspot_tickets.
 * Open tickets are re-read hourly so the usage report can say whether a follow-up was handled.
 *
 * Only events with a stored subject can be matched (recorded since widget_tracking_v2_since).
 * Env: HUBSPOT_ACCESS_TOKEN (tickets read scope).
 */
import { Repository } from "@/lib/db/repository";
import { getDb, type WidgetHubspotTicket } from "@/lib/db/index";

const API = "https://api.hubapi.com";
const LOOKBACK_SECONDS = 120 * 86400;
// Ticket createdate window around the widget event
const MATCH_BEFORE_SECONDS = 10 * 60;
const MATCH_AFTER_SECONDS = 6 * 3600;

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

async function hubspotPost<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

function ticketRow(t: HubspotTicket): { hubspot_ticket_id: string; status: WidgetHubspotTicket["status"]; ticket_created_at: number | null; closed_at: number | null } {
  const closedAt = toUnix(t.properties.closed_date);
  return { hubspot_ticket_id: t.id, status: closedAt ? "closed" : "open", ticket_created_at: toUnix(t.properties.createdate), closed_at: closedAt };
}

/** Find the ticket for one widget email: same subject, created closest to the email. */
async function findTicket(subject: string, sentAt: number, taken: Set<string>): Promise<HubspotTicket | null> {
  const data = await hubspotPost<{ results: HubspotTicket[] }>("/crm/v3/objects/tickets/search", {
    filterGroups: [{
      filters: [
        { propertyName: "subject", operator: "EQ", value: subject },
        { propertyName: "createdate", operator: "BETWEEN", value: String((sentAt - MATCH_BEFORE_SECONDS) * 1000), highValue: String((sentAt + MATCH_AFTER_SECONDS) * 1000) },
      ],
    }],
    properties: ["subject", "createdate", "closed_date"],
    sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
    limit: 10,
  });
  const free = data.results.filter((t) => !taken.has(t.id));
  free.sort((a, b) => Math.abs((toUnix(a.properties.createdate) ?? 0) - sentAt) - Math.abs((toUnix(b.properties.createdate) ?? 0) - sentAt));
  return free[0] ?? null;
}

/** Match new widget emails to HubSpot tickets and refresh the open ones. Safe to run often. */
export async function syncWidgetTickets(opts: { onLog?: (m: string) => void } = {}): Promise<TicketSyncResult> {
  const log = opts.onLog ?? (() => {});
  if (!isHubspotTicketSyncConfigured()) return { configured: false, ok: false, checked: 0, matched: 0 };

  const repo = new Repository(getDb());
  const since = Math.max(
    Number(repo.getAppMeta("widget_tracking_v2_since") ?? 0),
    Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS,
  );
  let checked = 0;
  let matched = 0;
  try {
    const candidates = repo.listWidgetTicketCandidates(since);
    const taken = repo.listLinkedHubspotTicketIds();

    // Already matched and still open: re-read them in one batch
    const open = candidates.filter((c) => c.ticket?.hubspot_ticket_id);
    for (let i = 0; i < open.length; i += 100) {
      const chunk = open.slice(i, i + 100);
      const data = await hubspotPost<{ results: HubspotTicket[] }>("/crm/v3/objects/tickets/batch/read", {
        properties: ["subject", "createdate", "closed_date"],
        inputs: chunk.map((c) => ({ id: c.ticket!.hubspot_ticket_id })),
      });
      const byId = new Map(data.results.map((t) => [t.id, t]));
      for (const c of chunk) {
        const t = byId.get(c.ticket!.hubspot_ticket_id!);
        // A ticket deleted in HubSpot no longer counts as handled or open
        repo.upsertWidgetHubspotTicket(c.event_id, t ? ticketRow(t) : { hubspot_ticket_id: null, status: "not_found", ticket_created_at: null, closed_at: null });
        checked++;
      }
    }

    // Not matched yet: search by subject and time
    for (const c of candidates.filter((x) => !x.ticket?.hubspot_ticket_id)) {
      let subject: string | undefined;
      try { subject = c.metadata ? (JSON.parse(c.metadata) as { subject?: string }).subject : undefined; } catch { /* */ }
      if (!subject) continue;
      const t = await findTicket(subject, c.created_at, taken);
      if (t) {
        taken.add(t.id);
        matched++;
      }
      repo.upsertWidgetHubspotTicket(c.event_id, t ? ticketRow(t) : { hubspot_ticket_id: null, status: "not_found", ticket_created_at: null, closed_at: null });
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
