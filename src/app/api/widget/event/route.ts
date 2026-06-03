import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb, type WidgetEventType } from "@/lib/db/index";
import { corsHeaders, resolveInstallation, extractClientIp, hashIp } from "@/lib/widget-auth";

const ALLOWED_TYPES = new Set<WidgetEventType>(["kb_click", "calendly_click", "email_submit"]);
// Client-emitted events: only the two click-throughs. email_submit is recorded
// server-side inside /api/widget/ticket on success, never trusted from a client.
const CLIENT_EMITTABLE = new Set<WidgetEventType>(["kb_click", "calendly_click"]);

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const resolution = resolveInstallation(req);
  if ("error" in resolution) return resolution.error;
  const { installation, matchedOrigin } = resolution;
  const cors = corsHeaders(matchedOrigin);

  let body: { type?: string; sourceUrl?: string };
  try {
    // sendBeacon sends a Blob with whatever MIME we picked — parse as JSON either way
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return new Response(null, { status: 204, headers: cors });
  }

  const type = body.type as WidgetEventType | undefined;
  if (!type || !ALLOWED_TYPES.has(type) || !CLIENT_EMITTABLE.has(type)) {
    // Ignore unknown / server-only types silently — no need to noisy 400 on a beacon
    return new Response(null, { status: 204, headers: cors });
  }

  const ipHash = hashIp(extractClientIp(req));
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : null;

  try {
    const repo = new Repository(getDb());
    repo.recordWidgetEvent({
      installation_id: installation.id,
      event_type: type,
      source_url: sourceUrl,
      ip_hash: ipHash,
      metadata: null,
    });
  } catch (e) {
    console.warn("[widget/event] record failed:", e);
  }

  return new Response(null, { status: 204, headers: cors });
}
