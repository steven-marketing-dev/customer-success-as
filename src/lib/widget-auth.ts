import crypto from "crypto";
import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb, type WidgetInstallation } from "@/lib/db/index";

export interface ResolvedInstallation {
  installation: WidgetInstallation;
  matchedOrigin: string;
}

export interface ResolveFailure {
  error: Response;
}

function requestOrigin(req: NextRequest): string | null {
  return req.headers.get("origin");
}

/** The API's own public origin, as the browser sees it. Must be derived from
 *  forwarded headers because req.url reflects the internal (container) URL when
 *  running behind a reverse proxy (Coolify/Traefik, Vercel, etc.) and won't match
 *  the browser's Origin header. */
function apiPublicOrigin(req: NextRequest): string | null {
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!hostHeader) return null;
  // forwarded headers may be comma-separated lists — take the first
  const host = hostHeader.split(",")[0]!.trim();
  const protoHeader = req.headers.get("x-forwarded-proto");
  const proto = protoHeader?.split(",")[0]?.trim()
    ?? (req.url.startsWith("https://") ? "https" : "http");
  return `${proto}://${host}`;
}

function parseAllowedOrigins(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CS-Widget-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonError(status: number, message: string, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extra },
  });
}

/** Resolve + validate the widget installation for a request.
 *  - key from ?key= or X-CS-Widget-Key header
 *  - installation must exist and be active
 *  - request Origin must match one of the allowed origins
 *  Returns either { installation, matchedOrigin } or { error: Response } ready to return. */
export function resolveInstallation(req: NextRequest): ResolvedInstallation | ResolveFailure {
  const origin = requestOrigin(req);
  const url = new URL(req.url);
  const key = req.headers.get("x-cs-widget-key") ?? url.searchParams.get("key");

  if (!key) return { error: jsonError(400, "Missing widget key", origin) };

  const repo = new Repository(getDb());
  const installation = repo.getWidgetInstallationByKey(key);
  if (!installation) return { error: jsonError(404, "Unknown widget key", origin) };
  if (!installation.is_active) return { error: jsonError(403, "Widget is disabled", origin) };

  const allowed = parseAllowedOrigins(installation.allowed_origins);

  // Same-origin requests (the iframe at /embed/chat calling its own API) are always
  // allowed — the iframe is served from our own host, so an Origin equal to the API's
  // public origin is us talking to us. The parent-origin gate is enforced by CSP
  // `frame-ancestors` set on /embed/chat, which decides who can embed the iframe.
  const apiOrigin = apiPublicOrigin(req);

  if (!origin) {
    // Browsers always send Origin on cross-origin POSTs. Missing Origin usually
    // means the iframe did a same-origin fetch (GET) or a non-browser client.
    if (allowed.includes("*")) return { installation, matchedOrigin: "*" };
    return { error: jsonError(403, "Origin header required", origin) };
  }

  if (apiOrigin && origin === apiOrigin) {
    return { installation, matchedOrigin: origin };
  }

  if (allowed.includes("*") || allowed.includes(origin)) {
    return { installation, matchedOrigin: origin };
  }

  return { error: jsonError(403, "Origin not allowed for this widget key", origin) };
}

export function extractClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? "widget-salt";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export interface RateCheckResult {
  ok: boolean;
  retryAfter?: number;
  remaining?: number;
}

/** Check + record a request against the installation's rate limit (per IP hash).
 *  Uses a sliding 1-hour window stored in widget_rate_events. */
export function checkAndRecordRate(installationId: number, ipHash: string, limitPerHour: number): RateCheckResult {
  const repo = new Repository(getDb());
  const used = repo.countWidgetRateEventsLastHour(installationId, ipHash);
  if (used >= limitPerHour) {
    return { ok: false, retryAfter: 3600, remaining: 0 };
  }
  repo.recordWidgetRateEvent(installationId, ipHash);
  return { ok: true, remaining: Math.max(0, limitPerHour - used - 1) };
}

/** Build a CSP `frame-ancestors` directive value from allowed origins.
 *  Falls back to 'none' when no origins are configured. */
export function buildFrameAncestorsValue(allowedOrigins: string[]): string {
  if (allowedOrigins.length === 0) return "'none'";
  if (allowedOrigins.includes("*")) return "*";
  // 'self' lets us preview the iframe in the admin app during development
  return [...allowedOrigins, "'self'"].join(" ");
}

export function getAllowedOrigins(installation: WidgetInstallation): string[] {
  return parseAllowedOrigins(installation.allowed_origins);
}
