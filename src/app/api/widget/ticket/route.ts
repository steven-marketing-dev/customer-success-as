import { NextRequest } from "next/server";
import { HubSpotClient } from "@/lib/hubspot";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";
import { corsHeaders, resolveInstallation, extractClientIp, hashIp, checkAndRecordRate } from "@/lib/widget-auth";
import { isIntakeEmailConfigured, getInboxAddress, sendWidgetIntakeEmail } from "@/lib/email/intake";

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

  // Preferred path: forward the submission into the connected HubSpot inbox as a
  // real inbound email. HubSpot creates a native email-channel thread + ticket, so
  // the n8n auto-responder has a thread to reply through and the original message
  // is preserved. Falls back to the direct CRM-ticket path when Mailgun/inbox env
  // isn't configured, so submissions never break during rollout.
  const useIntakeEmail = isIntakeEmailConfigured();
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!useIntakeEmail && !token) {
    console.error("[widget/ticket] no intake email config and HUBSPOT_ACCESS_TOKEN not set");
    return new Response(JSON.stringify({ error: "Ticket backend not configured" }), {
      status: 503, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  try {
    let via: "inbound_email" | "crm_ticket";

    if (useIntakeEmail) {
      // Human-readable body: the visitor's message first, then a metadata footer.
      // The "Visitor email:" line is parsed by the n8n workflow to address the reply
      // to the visitor (HubSpot sets the ticket contact to the intake address, not
      // the visitor, on this inbound email).
      const footer: string[] = [`Visitor email: ${email}`];
      if (installation.product_name) footer.push(`Product: ${installation.product_name}`);
      if (sourceUrl) footer.push(`Page: ${sourceUrl}`);
      footer.push("Submitted via the help widget");
      const text = `${description}\n\n—\n${footer.join("\n")}`;

      await sendWidgetIntakeEmail({
        visitorEmail: email,
        toInbox: getInboxAddress()!,
        subject,
        text,
      });
      via = "inbound_email";
    } else {
      const hubspot = new HubSpotClient(token!);
      await hubspot.createWidgetTicket({
        subject,
        description,
        fromEmail: email,
        sourceUrl,
        productName: installation.product_name,
      });
      via = "crm_ticket";
    }

    // Record the submission as an analytics event (best-effort, never blocks the response)
    try {
      const repo = new Repository(getDb());
      repo.recordWidgetEvent({
        installation_id: installation.id,
        event_type: "email_submit",
        source_url: sourceUrl,
        ip_hash: ipHash,
        metadata: { subjectLength: subject.length, via },
      });
    } catch (e) {
      console.warn("[widget/ticket] event record failed:", e);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (e) {
    console.error("[widget/ticket] submission failed:", e);
    return new Response(JSON.stringify({ error: "Could not submit your request. Please try again later." }), {
      status: 502, headers: { "Content-Type": "application/json", ...cors },
    });
  }
}
