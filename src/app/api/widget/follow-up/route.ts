import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";
import { corsHeaders, resolveInstallation, extractClientIp, hashIp, checkAndRecordRate, readWidgetContext } from "@/lib/widget-auth";
import { isValidEmail, isWidgetIntakeConfigured, submitWidgetIntake } from "@/lib/widget-intake";

/**
 * "Want us to follow up?" after a visitor rates an answer Not helpful (DIS-234). Sends the
 * question, the agent's answer and the visitor's feedback to support the same way as the
 * widget email form (a HubSpot ticket), and records a follow_up_request event for the report.
 */
const MAX_QUESTION = 2000;
const MAX_ANSWER = 4000;
const MAX_FEEDBACK = 2000;

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function POST(req: NextRequest) {
  const resolution = resolveInstallation(req);
  if ("error" in resolution) return resolution.error;
  const { installation, matchedOrigin } = resolution;
  const cors = corsHeaders(matchedOrigin);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });

  if (!installation.enable_email) return json({ error: "Email support is disabled for this widget" }, 403);

  // Rate limit shared with chat and the email form
  const ipHash = hashIp(extractClientIp(req));
  const rate = checkAndRecordRate(installation.id, ipHash, installation.rate_limit_per_hour);
  if (!rate.ok) return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": String(rate.retryAfter ?? 60) });

  let body: { exchangeId?: string; question?: string; answer?: string; feedback?: string | null; email?: string; sourceUrl?: string; sessionId?: string; userEmail?: string; account?: string };
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const exchangeId = typeof body.exchangeId === "string" ? body.exchangeId.slice(0, 64) : "";
  const question = (body.question ?? "").trim().slice(0, MAX_QUESTION);
  const answer = (body.answer ?? "").trim().slice(0, MAX_ANSWER);
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, MAX_FEEDBACK) : "";
  const email = (body.email ?? "").trim().slice(0, 200);
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : null;

  if (!exchangeId || !question) return json({ error: "Missing required fields" }, 400);
  if (!email || !isValidEmail(email)) return json({ error: "A valid email is required" }, 400);
  if (!isWidgetIntakeConfigured()) {
    console.error("[widget/follow-up] no intake email config and HUBSPOT_ACCESS_TOKEN not set");
    return json({ error: "Ticket backend not configured" }, 503);
  }

  const visitor = readWidgetContext(body);
  const subject = `Follow-up request: ${oneLine(question, 120)}`;
  const description = [
    "The visitor rated the help widget's answer Not helpful and asked to be contacted.",
    feedback ? `\nWhat would have been more helpful:\n${feedback}` : "",
    `\nQuestion:\n${question}`,
    answer ? `\nAgent's answer:\n${answer}` : "",
  ].join("\n").trim();

  try {
    const { via, ticketId } = await submitWidgetIntake({
      installation, subject, description, email, sourceUrl, sessionId: visitor.session_id,
      origin: "Requested after rating an answer Not helpful",
    });
    try {
      new Repository(getDb()).recordWidgetEvent({
        installation_id: installation.id,
        event_type: "follow_up_request",
        source_url: sourceUrl,
        ip_hash: ipHash,
        metadata: { subject, visitorEmail: email, via, exchangeId, ...(ticketId ? { ticketId } : {}) },
      }, { ...visitor, user_email: visitor.user_email ?? email.toLowerCase() });
    } catch (e) {
      console.warn("[widget/follow-up] event record failed:", e);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[widget/follow-up] submission failed:", e);
    return json({ error: "Could not send your request. Please try again later." }, 502);
  }
}
