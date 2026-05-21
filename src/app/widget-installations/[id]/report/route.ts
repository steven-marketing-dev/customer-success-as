import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { buildWidgetAnalyticsHtml } from "@/lib/widget-report";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (session.role !== "master") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const installationId = parseInt(id, 10);
  if (!Number.isFinite(installationId)) {
    return new NextResponse("Invalid id", { status: 400 });
  }

  const url = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= MAX_DAYS ? daysParam : DEFAULT_DAYS;
  const ratingParam = url.searchParams.get("rating");
  const ratingFilter = ratingParam === "1" ? 1 : ratingParam === "2" ? 2 : ratingParam === "3" ? 3 : null;

  const repo = new Repository();
  const installation = repo.getWidgetInstallationById(installationId);
  if (!installation) return new NextResponse("Not found", { status: 404 });

  const sinceTs = Math.floor(Date.now() / 1000) - days * 86400;

  const html = buildWidgetAnalyticsHtml({
    installation: {
      id: installation.id,
      name: installation.name,
      product_name: installation.product_name,
    },
    range: { days, since: sinceTs },
    top_questions: repo.getTopWidgetQuestions(installationId, sinceTs, 10),
    top_article_clicks: repo.getTopWidgetArticleClicks(installationId, sinceTs, 10),
    rating_breakdown: repo.getWidgetRatingBreakdown(installationId, sinceTs),
    ratings_feed: repo.getWidgetRatingsFeed(installationId, sinceTs, { ratingFilter, limit: 500 }),
    volume_by_day: repo.getWidgetVolumeByDay(installationId, days),
  }, { days, ratingFilter });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
