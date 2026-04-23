import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";
import { corsHeaders, resolveInstallation, extractClientIp, hashIp } from "@/lib/widget-auth";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const resolution = resolveInstallation(req);
  if ("error" in resolution) return resolution.error;
  const { installation, matchedOrigin } = resolution;
  const cors = corsHeaders(matchedOrigin);

  let body: {
    exchangeId?: string;
    rating?: number;
    feedback?: string | null;
    question?: string;
    answer?: string;
  };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const exchangeId = typeof body.exchangeId === "string" ? body.exchangeId.slice(0, 64) : "";
  const rating = body.rating;
  const question = (body.question ?? "").slice(0, 4000);
  const answer = (body.answer ?? "").slice(0, 8000);
  const feedback = typeof body.feedback === "string" ? body.feedback.slice(0, 2000) : null;

  if (!exchangeId || !question || !answer) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }
  if (rating !== 1 && rating !== 2 && rating !== 3) {
    return new Response(JSON.stringify({ error: "Rating must be 1, 2, or 3" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const ipHashValue = hashIp(extractClientIp(req));
  const repo = new Repository(getDb());
  repo.insertWidgetRating({
    installation_id: installation.id,
    exchange_id: exchangeId,
    rating,
    feedback,
    question,
    answer,
    ip_hash: ipHashValue,
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
}
