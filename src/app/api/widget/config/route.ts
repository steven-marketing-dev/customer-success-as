import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";
import { corsHeaders } from "@/lib/widget-auth";

/** Public bootstrap for the iframe. Returns light theming info for a widget key.
 *  No Origin check — the iframe page itself already ran under our CSP frame-ancestors
 *  policy, and nothing returned here is secret. */
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing key" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const repo = new Repository(getDb());
  const installation = repo.getWidgetInstallationByKey(key);
  if (!installation || !installation.is_active) {
    return new Response(JSON.stringify({ error: "Unknown or disabled widget" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  return new Response(JSON.stringify({
    productName: installation.product_name,
    primaryColor: installation.primary_color,
    calendlyUrl: installation.calendly_url,
    knowledgeBaseUrl: installation.knowledge_base_url,
    enableChat: !!installation.enable_chat,
    enableEmail: !!installation.enable_email,
    enableCalendly: !!installation.enable_calendly && !!installation.calendly_url,
    enableKnowledgeBase: !!installation.enable_knowledge_base && !!installation.knowledge_base_url,
  }), {
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
