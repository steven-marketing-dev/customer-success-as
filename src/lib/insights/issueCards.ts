/**
 * Issue Card assembly + urgency scoring + heuristic recommendations.
 *
 * Pure functions — no DB, no I/O. Takes pre-fetched aggregates and produces
 * the cards consumed by /api/dashboard/insights and the IssueCard UI.
 */

import { matchClarityToCategory, type ClarityHotspotLike } from "./urlMatcher";
import type { ExtractedEntity } from "./entityExtractor";

export interface EnrichedIssue {
  category_id: number;
  category_name: string;
  count: number;
  prev_count: number;
  last_seen: number;
  top_root_cause: string | null;
  resolved_pct: number;
  distinct_companies: number;
  top_companies: Array<{ company_name: string; ticket_count: number }>;
  sample_questions: string[];
}

export interface IssueEntityMention {
  name: string;
  doc_count: number;
  share_pct: number; // % of qa_pairs in this category that mention it
}

export interface AtRiskCustomerLike {
  company_name: string;
  suggest_onboarding: boolean;
}

export interface IssueCardLinkedUrl {
  page: string;
  pathname: string;
  friction_total: number;
  rage_clicks: number;
  dead_clicks: number;
  js_errors: number;
  quick_back: number;
}

export interface IssueCard {
  category_id: number;
  category_name: string;
  count: number;
  prev_count: number;
  trend: "up" | "down" | "flat";
  last_seen: number;
  top_root_cause: string | null;
  resolved_pct: number;
  distinct_companies: number;
  top_companies: Array<{ company_name: string; ticket_count: number; at_risk: boolean }>;
  sample_questions: string[];
  linked_urls: IssueCardLinkedUrl[];
  top_entities: IssueEntityMention[];
  recommendation: string;
  urgency_score: number;
}

const ROOT_CAUSE_LABEL: Record<string, string> = {
  ui_friction: "UI friction",
  onboarding_gap: "Onboarding gap",
  platform_bug: "Platform bug",
  feature_request: "Feature request",
  how_to: "How-to",
  billing: "Billing",
  other: "Other",
};

function pathOf(url: string): string {
  try { return new URL(url).pathname; }
  catch { return url; }
}

function trendOf(count: number, prev: number): "up" | "down" | "flat" {
  if (prev === 0) return count > 0 ? "up" : "flat";
  if (count >= prev * 1.25) return "up";
  if (count <= prev * 0.75) return "down";
  return "flat";
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

function joinCompanies(companies: Array<{ company_name: string }>, max = 3): string {
  const names = companies.slice(0, max).map((c) => c.company_name);
  if (names.length === 0) return "(none)";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Returns the dominant entity for a card if one stands out (≥30% of qa_pairs
 *  mention it). Used to make recommendations specific. */
function dominantEntity(card: IssueCard): IssueEntityMention | null {
  const top = card.top_entities[0];
  if (!top) return null;
  return top.share_pct >= 30 ? top : null;
}

/** Heuristic recommendation rule table. First match wins. Incorporates the
 *  dominant entity (e.g. "Indeed", "Stripe") when one stands out. */
export function recommendFor(card: IssueCard): string {
  const rc = card.top_root_cause ?? "other";
  const samp = card.sample_questions[0] ? truncate(card.sample_questions[0], 80) : "";
  const heaviestUrl = card.linked_urls[0];
  const companies = joinCompanies(card.top_companies);
  const dom = dominantEntity(card);
  const domTag = dom ? ` (mostly **${dom.name}** — ${dom.share_pct}% of tickets)` : "";

  if (rc === "platform_bug" && dom) {
    return `Loop in engineering — looks like a **${dom.name}** issue. ${dom.doc_count} of ${card.count} reports mention ${dom.name}${samp ? `; latest: "${samp}"` : ""}.`;
  }
  if (rc === "platform_bug" && heaviestUrl && heaviestUrl.rage_clicks >= 5) {
    return `Loop in engineering. ${heaviestUrl.pathname} has ${heaviestUrl.rage_clicks} rage clicks across ${card.distinct_companies} customer${card.distinct_companies === 1 ? "" : "s"}.`;
  }
  if (rc === "platform_bug") {
    return samp
      ? `Loop in engineering. ${card.count} reports in window — latest: "${samp}".`
      : `Loop in engineering. ${card.count} reports in window from ${card.distinct_companies} customer${card.distinct_companies === 1 ? "" : "s"}.`;
  }
  if (rc === "ui_friction" && heaviestUrl && heaviestUrl.friction_total >= 20) {
    return `UX fix opportunity on ${heaviestUrl.pathname} (${heaviestUrl.friction_total} friction sessions, ${card.distinct_companies} customer${card.distinct_companies === 1 ? "" : "s"} affected)${domTag}.`;
  }
  if (rc === "onboarding_gap" && card.distinct_companies >= 3) {
    return `Schedule onboarding sessions with: ${companies}${domTag}.`;
  }
  if (rc === "how_to" && card.count >= 5) {
    if (dom) {
      return `Write a KB article focused on **${dom.name}** — ${dom.doc_count} of ${card.count} how-to questions are about it${samp ? `. Top: "${samp}"` : ""}.`;
    }
    return samp
      ? `Write a KB article. Top question: "${samp}".`
      : `Write a KB article — ${card.count} how-to questions in this category.`;
  }
  if (rc === "feature_request") {
    return `Add to roadmap${dom ? ` (focus: **${dom.name}**)` : ""}. Customers asking: ${companies}.`;
  }
  if (rc === "billing") {
    return `Route to billing/finance. ${card.count} ticket${card.count === 1 ? "" : "s"} from ${card.distinct_companies} customer${card.distinct_companies === 1 ? "" : "s"}.`;
  }
  return `Investigate further — ${card.count} reports, ${card.distinct_companies} customer${card.distinct_companies === 1 ? "" : "s"}, top cause: ${ROOT_CAUSE_LABEL[rc] ?? rc}${domTag}.`;
}

/** Composite urgency score — higher = more urgent. Components are pre-normalized. */
export function urgencyScore(
  c: IssueCard,
  max: { count: number; companies: number; friction: number }
): number {
  const countNorm = max.count > 0 ? c.count / max.count : 0;
  const companyNorm = max.companies > 0 ? c.distinct_companies / max.companies : 0;
  const totalFriction = c.linked_urls.reduce((s, u) => s + u.friction_total, 0);
  const frictionNorm = max.friction > 0 ? totalFriction / max.friction : 0;

  // Recency: 1.0 if seen within last 3 days, decays linearly to 0 at 30 days
  const ageDays = (Date.now() / 1000 - c.last_seen) / 86400;
  const recencyNorm = ageDays <= 3 ? 1 : Math.max(0, 1 - (ageDays - 3) / 27);

  let score = 0.40 * countNorm + 0.20 * recencyNorm + 0.25 * companyNorm + 0.15 * frictionNorm;
  // Trend bonus when count is materially higher than prior window
  if (c.prev_count > 0 && c.count >= 1.5 * c.prev_count) score += 0.05;
  return score;
}

export function buildIssueCards(input: {
  enriched: EnrichedIssue[];
  hotspots: ClarityHotspotLike[];
  atRiskCompanies: Set<string>;
  entitiesByCategory: Map<number, ExtractedEntity[]>;
}): IssueCard[] {
  // Pass 1: assemble each card without recommendation/score (need maxes for score)
  const partial = input.enriched.map<IssueCard>((e) => {
    const linked = matchClarityToCategory(e.category_name, input.hotspots).map((h) => ({
      page: h.page,
      pathname: pathOf(h.page),
      friction_total: h.friction_total,
      rage_clicks: h.rage_clicks,
      dead_clicks: h.dead_clicks,
      js_errors: h.js_errors,
      quick_back: h.quick_back,
    }));

    const top_companies = e.top_companies.map((c) => ({
      company_name: c.company_name,
      ticket_count: c.ticket_count,
      at_risk: input.atRiskCompanies.has(c.company_name),
    }));

    const rawEntities = input.entitiesByCategory.get(e.category_id) ?? [];
    const top_entities: IssueEntityMention[] = rawEntities.map((ent) => ({
      name: ent.name,
      doc_count: ent.doc_count,
      share_pct: e.count > 0 ? Math.round((ent.doc_count / e.count) * 100) : 0,
    }));

    const card: IssueCard = {
      category_id: e.category_id,
      category_name: e.category_name,
      count: e.count,
      prev_count: e.prev_count,
      trend: trendOf(e.count, e.prev_count),
      last_seen: e.last_seen,
      top_root_cause: e.top_root_cause,
      resolved_pct: e.resolved_pct,
      distinct_companies: e.distinct_companies,
      top_companies,
      sample_questions: e.sample_questions,
      linked_urls: linked,
      top_entities,
      recommendation: "", // filled below
      urgency_score: 0,   // filled below
    };
    return card;
  });

  // Compute maxes for score normalization
  const max = partial.reduce(
    (acc, c) => ({
      count: Math.max(acc.count, c.count),
      companies: Math.max(acc.companies, c.distinct_companies),
      friction: Math.max(acc.friction, c.linked_urls.reduce((s, u) => s + u.friction_total, 0)),
    }),
    { count: 0, companies: 0, friction: 0 }
  );

  // Pass 2: fill recommendation + score, then sort
  for (const card of partial) {
    card.urgency_score = urgencyScore(card, max);
    card.recommendation = recommendFor(card);
  }

  return partial.sort((a, b) => {
    if (b.urgency_score !== a.urgency_score) return b.urgency_score - a.urgency_score;
    return b.count - a.count;
  });
}
