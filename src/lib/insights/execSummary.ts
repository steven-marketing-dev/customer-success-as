/**
 * Daily AI-generated executive summary.
 *
 * Takes the top 3 issue cards and produces a 2–3 sentence narrative for the
 * top of the dashboard. Cached in the `insight_cache` table keyed on
 * (today's UTC date, content_hash). Same data on the same day → cache hit.
 */

import crypto from "crypto";
import { generateJSON } from "../ai/provider";
import { Repository } from "../db/repository";
import type { IssueCard } from "./issueCards";

const SYSTEM = `You are a senior Customer Success leader writing a one-paragraph executive briefing. You synthesize signals into a clear "what's happening, why, what to do" narrative. Write naturally, not in bullet points. Respond ONLY with valid JSON.`;

interface SummaryPayload {
  text: string;
  generated_at: number;
}

function hashTopCards(cards: IssueCard[]): string {
  const minimal = cards.slice(0, 3).map((c) => ({
    name: c.category_name,
    count: c.count,
    prev: c.prev_count,
    rc: c.top_root_cause,
    companies: c.distinct_companies,
    top_co: c.top_companies.slice(0, 3).map((co) => co.company_name),
    paths: c.linked_urls.slice(0, 2).map((u) => u.pathname),
    rec: c.recommendation,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(minimal)).digest("hex").slice(0, 16);
}

function todayKey(range: string): string {
  // The summary varies per range — same day, different ranges = different summaries
  return `${new Date().toISOString().slice(0, 10)}:${range}`;
}

export async function getOrGenerateExecSummary(
  cards: IssueCard[],
  range: string
): Promise<string | null> {
  if (cards.length === 0) return null;
  const top = cards.slice(0, 3);
  const repo = new Repository();
  const dateKey = todayKey(range);
  const contentHash = hashTopCards(cards);

  const cached = repo.getInsightCache(dateKey, contentHash);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as SummaryPayload;
      if (parsed?.text) return parsed.text;
    } catch { /* fall through to regenerate */ }
  }

  const lines = top.map((c, i) => {
    const trendStr = c.prev_count > 0
      ? `${c.count} this period vs ${c.prev_count} prior`
      : `${c.count} this period`;
    const path = c.linked_urls[0]?.pathname;
    const cust = c.top_companies.slice(0, 2).map((co) => co.company_name).join(", ");
    return `${i + 1}. "${c.category_name}" — ${trendStr}, ${c.distinct_companies} customers${cust ? ` (top: ${cust})` : ""}, root cause: ${c.top_root_cause ?? "other"}${path ? `, friction on ${path}` : ""}. Recommendation: ${c.recommendation}`;
  }).join("\n");

  const prompt = `Below are the top 3 customer-success issues for the current window (range: ${range}).

${lines}

Write a 2–3 sentence executive briefing (single paragraph, no bullet points) that synthesizes these into a coherent narrative. Lead with the most urgent issue. Mention the cross-cutting pattern if there is one (e.g., "two of these point to the same page", "the same customer appears across two issues", "all three are how-to questions suggesting a documentation gap"). Keep it punchy and decision-oriented — assume the reader is a CS manager who needs to act. Don't restate the numbers; interpret them.

Return ONLY this JSON:
{ "text": "<the paragraph>" }`;

  try {
    const raw = await generateJSON(SYSTEM, prompt);
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
    const parsed = JSON.parse(cleaned) as { text?: string };
    const text = (parsed.text ?? "").trim();
    if (!text) return null;

    repo.setInsightCache(dateKey, contentHash, JSON.stringify({ text, generated_at: Math.floor(Date.now() / 1000) } satisfies SummaryPayload));
    return text;
  } catch {
    return null;
  }
}
