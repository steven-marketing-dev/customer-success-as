import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { Repository } from "./db/repository";

const BASE_URL = "https://knowledge-base.discovered.ai";
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const CONCURRENCY = 5;

export interface ScrapeProgress {
  type: "log" | "progress" | "done";
  message?: string;
  current?: number;
  total?: number;
  stats?: { created: number; updated: number; unchanged: number; failed: number };
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Fetch sitemap.xml and extract article URLs */
async function fetchSitemapUrls(): Promise<string[]> {
  const res = await fetch(SITEMAP_URL);
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const urls: string[] = [];
  $("url > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc.includes("/article/")) urls.push(loc);
  });

  // Handle sitemap index pointing to sub-sitemaps
  if (urls.length === 0) {
    const subSitemaps: string[] = [];
    $("sitemap > loc").each((_, el) => {
      subSitemaps.push($(el).text().trim());
    });
    for (const sub of subSitemaps) {
      const subRes = await fetch(sub);
      if (!subRes.ok) continue;
      const subXml = await subRes.text();
      const $sub = cheerio.load(subXml, { xmlMode: true });
      $sub("url > loc").each((_, el) => {
        const loc = $sub(el).text().trim();
        if (loc.includes("/article/")) urls.push(loc);
      });
    }
  }

  return urls;
}

interface ScrapedArticle {
  title: string;
  content: string;
  category: string | null;
  sourceId: number | null;
}

type FetchOutcome =
  | { ok: true; article: ScrapedArticle }
  | { ok: false; status: number | null };

/** Extract article data from __NEXT_DATA__ JSON embedded in the page */
async function scrapeArticle(url: string): Promise<FetchOutcome> {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, status: res.status };
  const html = await res.text();
  const $ = cheerio.load(html);

  // Try extracting from __NEXT_DATA__ first (Next.js site)
  const nextDataScript = $("#__NEXT_DATA__").html();
  if (nextDataScript) {
    try {
      const data = JSON.parse(nextDataScript);
      const article = data?.props?.pageProps?.articleContent;
      if (article) {
        const title = article.title || "";
        const htmlContent: string = article.content || "";
        const lead: string = article.lead || "";
        // `articleId` is the stable parent-entity id; `id` is the row/revision id that changes on edit.
        const rawId = article.articleId ?? article.id;
        const parsedId = typeof rawId === "number" ? rawId : typeof rawId === "string" ? parseInt(rawId, 10) : NaN;
        const sourceId = Number.isFinite(parsedId) ? parsedId : null;

        // Convert HTML content to plain text
        const $content = cheerio.load(htmlContent);
        $content("script, style, iframe, figure, img").remove();
        const textContent = $content.text().replace(/\s+/g, " ").trim();
        const fullText = lead ? `${lead}\n\n${textContent}` : textContent;

        // Extract category from allCategories
        let category: string | null = null;
        const categories = data?.props?.pageProps?.allCategories;
        if (Array.isArray(categories) && categories.length > 0) {
          const articleCatId = article.categoryId;
          if (articleCatId) {
            const cat = categories.find((c: { id: number }) => c.id === articleCatId);
            if (cat?.title) category = cat.title;
          }
        }

        return { ok: true, article: { title, content: fullText, category, sourceId } };
      }
    } catch {
      // Fall through to HTML extraction
    }
  }

  // Fallback: extract from HTML directly (no stable source id available)
  const title = $("h1").first().text().trim() || $("title").text().trim();
  $("script, style, nav, footer, header, iframe, figure").remove();
  const content = $("article, main, .article-body, .content")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  if (!title || !content) return { ok: false, status: null };

  const slug = url.replace(/.*\/article\//, "").replace(/\/$/, "");
  const category = inferCategoryFromSlug(slug);
  return { ok: true, article: { title, content, category, sourceId: null } };
}

function inferCategoryFromSlug(slug: string): string | null {
  const categoryKeywords: Record<string, string> = {
    "sign": "Account Setup & General",
    "password": "Account Setup & General",
    "account": "Account Setup & General",
    "two-factor": "Account Setup & General",
    "job-post": "Job Posts",
    "job post": "Job Posts",
    "assessment": "Assessments",
    "talent-grader": "Employee Talent Grader",
    "kingsley": "Kingsley AI",
    "candidate": "Managing Candidates",
    "pipeline": "Managing Candidates",
    "sequence": "Managing Candidates",
    "template": "Job Posts",
    "share": "Job Posts",
  };

  for (const [keyword, cat] of Object.entries(categoryKeywords)) {
    if (slug.includes(keyword)) return cat;
  }
  return null;
}

/** Run concurrent tasks with a concurrency limit */
async function poolMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/** Main scrape orchestrator */
export async function runScrape(
  onProgress?: (event: ScrapeProgress) => void,
): Promise<{ created: number; updated: number; unchanged: number; failed: number }> {
  const repo = new Repository();
  const emit = (event: ScrapeProgress) => onProgress?.(event);

  // One-time backfill: stamp source_id on legacy rows by re-fetching their URL.
  // After this pass, slug changes on the source CMS collapse onto the existing row
  // via source_id rather than inserting a duplicate.
  const legacy = repo.getKBArticlesMissingSourceId();
  if (legacy.length > 0) {
    emit({ type: "log", message: `Backfilling source_id for ${legacy.length} legacy article(s)...` });
    let backfilled = 0;
    let deleted = 0;
    let collisions = 0;
    await poolMap(
      legacy,
      async (row) => {
        try {
          const outcome = await scrapeArticle(row.url);
          if (!outcome.ok) {
            if (outcome.status === 404 || outcome.status === 410) {
              repo.deleteKBArticle(row.id);
              deleted++;
              emit({ type: "log", message: `🗑 Deleted stale (${outcome.status}): ${row.url}` });
            }
            return;
          }
          if (outcome.article.sourceId == null) return;
          if (repo.setKBArticleSourceId(row.id, outcome.article.sourceId)) {
            backfilled++;
          } else {
            collisions++;
            emit({ type: "log", message: `⚠ source_id ${outcome.article.sourceId} already owned by another row — manual merge needed for: ${row.url}` });
          }
        } catch {
          // Network hiccups: skip; next run will retry.
        }
      },
      CONCURRENCY,
    );
    emit({ type: "log", message: `Backfill done: ${backfilled} stamped, ${deleted} deleted (404/410), ${collisions} collisions` });
  }

  emit({ type: "log", message: "Fetching sitemap..." });
  const urls = await fetchSitemapUrls();
  emit({ type: "log", message: `Found ${urls.length} article URLs` });

  const stats = { created: 0, updated: 0, unchanged: 0, failed: 0 };

  await poolMap(
    urls,
    async (url, index) => {
      try {
        const outcome = await scrapeArticle(url);
        if (!outcome.ok || !outcome.article.content) {
          stats.failed++;
          emit({ type: "log", message: `✗ [${index + 1}/${urls.length}] Empty: ${url}` });
          return;
        }
        const article = outcome.article;

        const hash = computeHash(article.content);
        const result = repo.upsertKBArticle({
          url,
          source_id: article.sourceId,
          title: article.title,
          content: article.content,
          category: article.category,
          content_hash: hash,
        });

        stats[result.action]++;
        // Link existing glossary terms to this article
        repo.autoLinkTermsToArticle(result.articleId);
        const icon = result.action === "unchanged" ? "–" : "✓";
        emit({
          type: "progress",
          message: `${icon} [${index + 1}/${urls.length}] ${result.action}: "${article.title}"`,
          current: index + 1,
          total: urls.length,
        });
      } catch (err) {
        stats.failed++;
        emit({ type: "log", message: `✗ [${index + 1}/${urls.length}] Error: ${url} — ${err}` });
      }
    },
    CONCURRENCY,
  );

  emit({ type: "done", message: `Scraping complete: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.failed} failed`, stats });
  return stats;
}
