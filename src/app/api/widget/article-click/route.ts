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

  // Tolerant body parsing — sendBeacon sometimes posts as text/plain
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return new Response(JSON.stringify({ error: "Unable to read body" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  let body: {
    questionId?: number | string | null;
    articleId?: number | string | null;
    title?: string;
    url?: string;
  };
  try { body = raw ? JSON.parse(raw) : {}; }
  catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 500) : "";
  if (!url || !title) {
    return new Response(JSON.stringify({ error: "Missing url or title" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }
  const questionId = body.questionId != null && body.questionId !== "" ? Number(body.questionId) : null;
  const articleId = body.articleId != null && body.articleId !== "" ? Number(body.articleId) : null;

  const repo = new Repository(getDb());
  const ipHash = hashIp(extractClientIp(req));
  try {
    repo.insertWidgetArticleClick({
      installation_id: installation.id,
      question_id: Number.isFinite(questionId) ? questionId : null,
      article_id: Number.isFinite(articleId) ? articleId : null,
      article_title: title,
      article_url: url,
      ip_hash: ipHash,
    });
  } catch { /* best-effort */ }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
}
