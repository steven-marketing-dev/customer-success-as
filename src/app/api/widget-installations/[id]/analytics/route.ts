import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function requireMaster(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const session = requireAuth(req);
  if (!session) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (session.role !== "master") return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const installationId = parseInt(id, 10);
  if (!Number.isFinite(installationId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= MAX_DAYS ? daysParam : DEFAULT_DAYS;
  const ratingFilter = url.searchParams.get("rating");
  const ratingFilterValue = ratingFilter === "1" ? 1 : ratingFilter === "2" ? 2 : ratingFilter === "3" ? 3 : null;

  const repo = new Repository();
  const installation = repo.getWidgetInstallationById(installationId);
  if (!installation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sinceTs = Math.floor(Date.now() / 1000) - days * 86400;

  const [topQuestions, topClicks, ratingsFeed, ratingBreakdown, volume] = [
    repo.getTopWidgetQuestions(installationId, sinceTs, 10),
    repo.getTopWidgetArticleClicks(installationId, sinceTs, 10),
    repo.getWidgetRatingsFeed(installationId, sinceTs, { ratingFilter: ratingFilterValue, limit: 50 }),
    repo.getWidgetRatingBreakdown(installationId, sinceTs),
    repo.getWidgetVolumeByDay(installationId, days),
  ];

  // Menu-action events (KB click, Calendly click, email submit) — recorded in widget_events
  const menuActions = repo.getInstallationAnalytics(installationId, days);

  return NextResponse.json({
    installation: {
      id: installation.id,
      name: installation.name,
      product_name: installation.product_name,
    },
    range: { days, since: sinceTs },
    top_questions: topQuestions,
    top_article_clicks: topClicks,
    rating_breakdown: ratingBreakdown,
    ratings_feed: ratingsFeed,
    volume_by_day: volume,
    menu_actions: menuActions,
  });
}
