/**
 * URL ↔ category-name fuzzy matcher.
 *
 * Categories are auto-clustered topic names (e.g., "Job Posting & Job Boards");
 * Clarity hotspots are URLs (e.g., https://myaccount.discovered.ai/job-posts).
 * We tokenize the category name and match tokens as substrings against the URL
 * pathname. Aggressive stopword/short-token filtering means generic categories
 * ("Technical Issues & Platform Performance") match nothing — that's correct.
 */

const STOPWORDS = new Set([
  "and", "or", "the", "of", "a", "an", "to", "for", "in", "on", "with", "&",
  "management", "issues", "performance", "technical", "platform", "general",
  "other", "misc",
]);

export function tokensForCategory(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[&/_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => t.length >= 3) // 3+ chars — feature names like "job", "api", "url" matter
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

export interface ClarityHotspotLike {
  page: string;
  traffic: number;
  rage_clicks: number;
  dead_clicks: number;
  js_errors: number;
  quick_back: number;
  friction_total: number;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    // Fallback for non-URL strings — still try to extract a path-like fragment
    const idx = url.indexOf("/", url.indexOf("//") + 2);
    return idx >= 0 ? url.slice(idx).toLowerCase() : url.toLowerCase();
  }
}

export function matchClarityToCategory<T extends ClarityHotspotLike>(
  categoryName: string,
  hotspots: T[],
  cap = 2
): T[] {
  const tokens = tokensForCategory(categoryName);
  if (tokens.length === 0) return [];

  const matched = hotspots.filter((h) => {
    const path = safePathname(h.page);
    return tokens.some((t) => path.includes(t));
  });

  return [...matched].sort((a, b) => b.friction_total - a.friction_total).slice(0, cap);
}
