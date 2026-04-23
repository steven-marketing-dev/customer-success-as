import { NextRequest } from "next/server";
import { HubSpotClient } from "@/lib/hubspot";
import { corsHeaders, resolveInstallation, extractClientIp, hashIp, checkAndRecordRate } from "@/lib/widget-auth";

const MAX_SUBJECT = 200;
const MAX_DESCRIPTION = 6000;

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const resolution = resolveInstallation(req);
  if ("error" in resolution) return resolution.error;
  const { installation, matchedOrigin } = resolution;
  const cors = corsHeaders(matchedOrigin);

  if (!installation.enable_email) {
    return new Response(JSON.stringify({ error: "Email support is disabled for this widget" }), {
      status: 403, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  // Rate limit shared with chat — per-IP, per-installation, per-hour
  const ipHash = hashIp(extractClientIp(req));
  const rate = checkAndRecordRate(installation.id, ipHash, installation.rate_limit_per_hour);
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rate.retryAfter ?? 60), ...cors },
    });
  }

  let body: { subject?: string; description?: string; email?: string; sourceUrl?: string };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const subject = (body.subject ?? "").trim().slice(0, MAX_SUBJECT);
  const description = (body.description ?? "").trim().slice(0, MAX_DESCRIPTION);
  const email = (body.email ?? "").trim().slice(0, 200);
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : null;

  if (!subject) return new Response(JSON.stringify({ error: "Subject is required" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
  if (!description) return new Response(JSON.stringify({ error: "Description is required" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
  if (!email || !isValidEmail(email)) return new Response(JSON.stringify({ error: "A valid email is required" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.error("[widget/ticket] HUBSPOT_ACCESS_TOKEN not configured");
    return new Response(JSON.stringify({ error: "Ticket backend not configured" }), {
      status: 503, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  try {
    const hubspot = new HubSpotClient(token);
    const ticket = await hubspot.createWidgetTicket({
      subject,
      description,
      fromEmail: email,
      sourceUrl,
      productName: installation.product_name,
    });
    return new Response(JSON.stringify({ ok: true, ticketId: ticket.id }), {
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (e) {
    console.error("[widget/ticket] HubSpot create failed:", e);
    return new Response(JSON.stringify({ error: "Could not submit your request. Please try again later." }), {
      status: 502, headers: { "Content-Type": "application/json", ...cors },
    });
  }
}
