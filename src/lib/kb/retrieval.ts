import type { Repository } from "@/lib/db/repository";
import type { BehavioralCard, KBArticle, Term } from "@/lib/db/index";

/**
 * KB retrieval + plain-text formatting, used by the MCP server (/api/mcp).
 *
 * Mirrors the retrieval block in /api/agent/chat and /api/agent/answer (same
 * repository calls, same limits, same tagged block format) so an external
 * Claude sees exactly the context the in-app agent sees.
 */

export const DEFAULT_LIMITS = { qa: 8, articles: 3, refDocs: 6, videos: 3 } as const;

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + "..." : s);

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// --- Retrieval ---

export function searchQA(repo: Repository, query: string, limit: number = DEFAULT_LIMITS.qa, categoryId?: number) {
  return repo.searchByKeywords(query, limit, categoryId);
}

export function lookupGlossary(repo: Repository, query: string, limit = 15): Term[] {
  const seen = new Set<number>();
  const out: Term[] = [];
  for (const t of [...repo.getMatchingTermsForQuery(query), ...repo.searchTerms(query)]) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out.slice(0, limit);
}

/**
 * Keyword-matched articles plus up to `limit` more linked to matching glossary
 * terms. The term-linked set must be capped: broad terms ("assessment") link to
 * dozens of articles, which blew a single response past 100 KB.
 */
export function searchArticles(repo: Repository, query: string, limit: number = DEFAULT_LIMITS.articles): KBArticle[] {
  const articles = repo.searchKBArticles(query, limit);
  const seen = new Set(articles.map((a) => a.id));
  let linked = 0;
  for (const a of repo.getMatchingTermsForQuery(query).flatMap((t) => repo.getArticlesForTerm(t.id))) {
    if (linked >= limit) break;
    if (!seen.has(a.id)) {
      articles.push(a);
      seen.add(a.id);
      linked++;
    }
  }
  return articles;
}

export function searchRefDocs(repo: Repository, query: string, limit: number = DEFAULT_LIMITS.refDocs) {
  try {
    return repo.searchRefDocSections(query, limit);
  } catch (e) {
    console.warn("[kb/retrieval] ref_docs fetch error:", e);
    return [];
  }
}

export function searchVideoGuides(repo: Repository, query: string, limit: number = DEFAULT_LIMITS.videos) {
  try {
    return repo.searchProcessCards(query, limit);
  } catch (e) {
    console.warn("[kb/retrieval] process_cards fetch error:", e);
    return [];
  }
}

export function getRules(repo: Repository, categoryIds: number[] = []) {
  try {
    return {
      global: repo.getGlobalBehavioralCards(),
      category: categoryIds.length > 0 ? repo.getBehavioralCardsForCategories(categoryIds) : [],
    };
  } catch (e) {
    console.warn("[kb/retrieval] behavioral_cards fetch error:", e);
    return { global: [] as BehavioralCard[], category: [] as BehavioralCard[] };
  }
}

// --- Formatting (same tags as the in-app agent context) ---

type QAResult = ReturnType<typeof searchQA>[number];

export function formatQA(results: QAResult[]): string {
  if (results.length === 0) return "No matching Q&A entries.";
  return results
    .map((qa) => {
      let entry = `[ID:${qa.id}] Category: ${qa.category_name ?? "Uncategorized"}\nQ: ${qa.question}`;
      if (qa.question_template && qa.question_template !== qa.question) entry += `\nPattern: ${qa.question_template}`;
      entry += `\nA: ${qa.answer ?? qa.summary ?? "(no answer recorded)"}`;
      entry += `\nResolved: ${qa.resolved ? "Yes" : "No"}`;
      const steps = parseJsonArray(qa.resolution_steps);
      if (steps.length > 0) entry += `\nResolution Steps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
      return entry;
    })
    .join("\n\n");
}

export function formatArticles(articles: KBArticle[], maxChars = 2000): string {
  if (articles.length === 0) return "No matching KB articles.";
  return articles
    .map((a) => `[Article:${a.id}] ${a.title} ${a.url}${a.category ? ` (${a.category})` : ""}\n${truncate(a.content, maxChars)}`)
    .join("\n\n");
}

export function formatGlossary(terms: Term[]): string {
  if (terms.length === 0) return "No matching glossary terms.";
  return terms
    .map((t) => {
      const aliases = parseJsonArray(t.aliases);
      return `• ${t.name}: ${t.definition}${aliases.length > 0 ? ` (also: ${aliases.join(", ")})` : ""}`;
    })
    .join("\n");
}

export function formatRefDocs(sections: ReturnType<typeof searchRefDocs>): string {
  if (sections.length === 0) return "No matching reference doc sections.";
  return sections.map((s) => `[REF:${s.id}] ${s.doc_title} > ${s.heading}\n${truncate(s.content, 2000)}`).join("\n\n");
}

export function formatVideoGuides(cards: ReturnType<typeof searchVideoGuides>): string {
  if (cards.length === 0) return "No matching video guides.";
  return cards
    .map((pc) => {
      const steps = parseJsonArray(pc.steps);
      return `[VIDEO:${pc.id}] ${pc.title}\nSummary: ${pc.summary}\nSteps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\nVideo: ${pc.loom_url}`;
    })
    .join("\n\n");
}

export function formatRules(rules: ReturnType<typeof getRules>): string {
  const lines: string[] = [];
  const tag = (scope: string, r: BehavioralCard) => `[${scope}${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`;
  for (const r of rules.global) lines.push(tag("GLOBAL", r));
  for (const r of rules.category) lines.push(tag("CATEGORY", r));
  return lines.length > 0 ? lines.join("\n") : "No behavioral rules.";
}

// --- Combined search ---

export type KbSource = "qa" | "articles" | "glossary" | "ref_docs" | "videos" | "rules";
export const ALL_SOURCES: KbSource[] = ["qa", "articles", "glossary", "ref_docs", "videos", "rules"];

/** One-shot retrieval across every KB source, formatted as labelled sections. */
export function searchAll(repo: Repository, query: string, sources: KbSource[] = ALL_SOURCES): string {
  const want = new Set(sources);
  const qa = want.has("qa") || want.has("rules") ? searchQA(repo, query) : [];
  const sections: string[] = [];

  if (want.has("glossary")) sections.push(`## GLOSSARY\n${formatGlossary(repo.getMatchingTermsForQuery(query))}`);
  if (want.has("qa")) sections.push(`## Q&A (from resolved support tickets)\n${formatQA(qa)}`);
  if (want.has("articles")) sections.push(`## KB ARTICLES (truncated — use get_article for full text)\n${formatArticles(searchArticles(repo, query), 1200)}`);
  if (want.has("ref_docs")) sections.push(`## REFERENCE DOCS\n${formatRefDocs(searchRefDocs(repo, query))}`);
  if (want.has("videos")) sections.push(`## VIDEO GUIDES\n${formatVideoGuides(searchVideoGuides(repo, query))}`);
  if (want.has("rules")) {
    const categoryIds = [...new Set(qa.map((q) => q.category_id).filter((id): id is number => id != null))];
    sections.push(`## BEHAVIORAL RULES\n${formatRules(getRules(repo, categoryIds))}`);
  }

  return sections.join("\n\n");
}
