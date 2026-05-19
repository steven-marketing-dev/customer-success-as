import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { ClarityClient } from "@/lib/clarity";
import { buildIssueCards } from "@/lib/insights/issueCards";
import { getOrGenerateExecSummary } from "@/lib/insights/execSummary";
import { extractEntities, type ExtractedEntity } from "@/lib/insights/entityExtractor";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "all": null,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "30d";
  const days = rangeParam in RANGE_DAYS ? RANGE_DAYS[rangeParam] : 30;
  const sinceTs = days === null ? null : Math.floor(Date.now() / 1000) - days * 86400;

  const repo = new Repository();

  const stats = repo.getInsightStats(sinceTs);
  const recurring = repo.getRecurringIssues(sinceTs);
  const root_cause_breakdown = repo.getRootCauseBreakdown(sinceTs);
  const root_cause_trend = repo.getRootCauseTrend(sinceTs, 7);
  const at_risk_customers = repo.getAtRiskCustomers(sinceTs);
  const ux_hotspots = repo.getClarityHotspots(sinceTs);
  const clarity_configured = ClarityClient.isConfigured();

  // Phase 2: Issue Cards (synthesis layer)
  const enriched = repo.getRecurringIssuesEnriched(sinceTs);
  const atRiskCompanies = new Set(
    at_risk_customers.filter((c) => c.suggest_onboarding).map((c) => c.company_name)
  );

  // Per-category entity extraction — surfaces cross-cutting topics like
  // "Indeed", "Stripe", "LinkedIn" that get diluted by category grouping.
  const categoryIds = enriched.map((e) => e.category_id);
  const textsByCategory = repo.getCategoryQATexts(categoryIds, sinceTs);
  const entitiesByCategory = new Map<number, ExtractedEntity[]>();
  for (const e of enriched) {
    const texts = textsByCategory.get(e.category_id) ?? [];
    // Require at least 2 distinct documents mentioning an entity to surface it
    entitiesByCategory.set(e.category_id, extractEntities(texts, { minDocFreq: 2, limit: 5 }));
  }

  const issue_cards = buildIssueCards({
    enriched,
    hotspots: ux_hotspots,
    atRiskCompanies,
    entitiesByCategory,
  });

  // AI executive summary — single Haiku call, cached daily by data hash.
  // Don't await failure — fall back to null silently to never block the dashboard.
  let executive_summary: string | null = null;
  try {
    executive_summary = await getOrGenerateExecSummary(issue_cards, rangeParam);
  } catch {
    executive_summary = null;
  }

  return NextResponse.json({
    range: rangeParam,
    stats,
    recurring,
    issue_cards,
    executive_summary,
    root_cause_breakdown,
    root_cause_trend,
    at_risk_customers,
    ux_hotspots,
    clarity_configured,
  });
}
