import { Repository } from "./db/repository";
import { getDb, rebuildFtsIndexes } from "./db/index";
import { BASE_URL, articleHtmlToText, computeHash } from "./scraper";

/**
 * Incremental KB sync from the Product Fruits Knowledge Base API.
 *
 * Replaces the sitemap scrape as the main source of kb_articles:
 *   1. GET /articles lists every article with per-language content entries and lastModified.
 *   2. Only articles with a published English content entry that are neither private nor hidden
 *      are eligible — the same set the public site lists in its sitemap. Drafts never reach the bot.
 *   3. Articles whose published lastModified matches the stored source_modified_at are skipped;
 *      the rest are fetched (published version, HTML) and upserted by source_id = PF article id.
 *   4. Stored articles that are no longer eligible are deleted.
 *
 * Content is converted with the same function the scraper uses, so hashes of unchanged
 * articles match the rows the scraper wrote.
 */

const API_BASE = "https://api.productfruits.com/v1/knowledgebase";
const LANG = "en";
// PF allows 5 requests/second for the whole REST API; stay well under it.
const REQUEST_GAP_MS = 300;
const MAX_RETRIES = 4;
// Refuse to delete when the listing shrinks this much: more likely an API problem than real deletions.
const MIN_ELIGIBLE_RATIO = 0.5;

export interface PFSyncStats {
  dryRun: boolean;
  listed: number;
  eligible: number;
  skippedUnpublished: number;
  skippedHidden: number;
  skippedPrivate: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  failed: number;
}

interface PFContentEntry {
  id: string;
  lang: string;
  published: boolean;
  lastModified: string;
}

interface PFArticle {
  id: string;
  lastModified: string;
  categoryId: number | null;
  isPrivate: boolean;
  isHidden: boolean;
  contents: PFContentEntry[];
}

interface PFCategory {
  id: number;
  contents: Array<{ lang: string; title: string }>;
}

interface PFArticleContent {
  articleId: number;
  title: string;
  slug: string;
  lead: string;
  published: boolean;
  lastModified: string;
  content: string;
}

interface Fetched {
  sourceId: number;
  modifiedAt: string;
  url: string;
  title: string;
  content: string;
  category: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isProductFruitsConfigured(): boolean {
  return !!process.env.PRODUCT_FRUITS_API_TOKEN;
}

async function pfGet<T>(path: string): Promise<T> {
  const token = process.env.PRODUCT_FRUITS_API_TOKEN;
  if (!token) throw new Error("PRODUCT_FRUITS_API_TOKEN not configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new Error(`Product Fruits GET ${path} failed: ${res.status}`);
  }
}

let running: Promise<PFSyncStats> | null = null;

/** Runs the sync; concurrent callers (cron, API route, Pipeline button) share the run in progress. */
export function syncFromProductFruits(
  opts: { dryRun?: boolean; onLog?: (message: string) => void } = {},
): Promise<PFSyncStats> {
  if (running) {
    opts.onLog?.("A Product Fruits sync is already running — waiting for it.");
    return running;
  }
  running = runSync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(opts: { dryRun?: boolean; onLog?: (message: string) => void }): Promise<PFSyncStats> {
  const dryRun = !!opts.dryRun;
  const log = (m: string) => opts.onLog?.(m);
  const repo = new Repository(getDb());
  const stats: PFSyncStats = {
    dryRun, listed: 0, eligible: 0, skippedUnpublished: 0, skippedHidden: 0, skippedPrivate: 0,
    fetched: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, failed: 0,
  };

  // ── 1. List articles and categories ───────────────────────────────────────
  const { articles } = await pfGet<{ articles: PFArticle[] }>("/articles");
  const { categories } = await pfGet<{ categories: PFCategory[] }>("/categories");
  const categoryTitle = new Map<number, string>();
  for (const c of categories) {
    const title = c.contents.find((x) => x.lang === LANG)?.title;
    if (title) categoryTitle.set(c.id, title);
  }
  stats.listed = articles.length;

  const eligible: Array<{ article: PFArticle; published: PFContentEntry }> = [];
  for (const article of articles) {
    const published = article.contents.find((c) => c.lang === LANG && c.published);
    if (!published) { stats.skippedUnpublished++; continue; }
    if (article.isPrivate) { stats.skippedPrivate++; continue; }
    if (article.isHidden) { stats.skippedHidden++; continue; }
    eligible.push({ article, published });
  }
  stats.eligible = eligible.length;
  log(`Product Fruits: ${stats.listed} articles listed, ${stats.eligible} eligible (skipped ${stats.skippedUnpublished} unpublished, ${stats.skippedHidden} hidden, ${stats.skippedPrivate} private)`);

  const index = repo.getKBArticleSyncIndex();
  const bySourceId = new Map(index.filter((r) => r.source_id != null).map((r) => [r.source_id as number, r]));
  const withSourceId = bySourceId.size;
  if (withSourceId > 0 && eligible.length < withSourceId * MIN_ELIGIBLE_RATIO) {
    throw new Error(`Only ${eligible.length} eligible articles vs ${withSourceId} stored — aborting to avoid mass deletion`);
  }

  // ── 2. Fetch only new or changed articles (no DB writes while awaiting) ─────
  const keepIds = new Set<number>();
  const toFetch: typeof eligible = [];
  for (const e of eligible) {
    const row = bySourceId.get(Number(e.article.id));
    if (row && row.source_modified_at === e.published.lastModified) {
      keepIds.add(row.id);
      stats.unchanged++;
    } else {
      toFetch.push(e);
    }
  }
  log(`${stats.unchanged} unchanged since last sync, ${toFetch.length} to fetch`);

  const fetched: Fetched[] = [];
  for (const [i, e] of toFetch.entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    try {
      const c = await pfGet<PFArticleContent>(`/articles/pf_${e.article.id}/content/${LANG}?format=html`);
      if (!c.published) {
        // The API answered with a draft: never let it reach the bot, keep whatever is stored.
        stats.failed++;
        const row = bySourceId.get(Number(e.article.id));
        if (row) keepIds.add(row.id);
        log(`✗ pf_${e.article.id}: content endpoint returned an unpublished version — skipped`);
        continue;
      }
      fetched.push({
        sourceId: Number(e.article.id),
        modifiedAt: e.published.lastModified,
        url: `${BASE_URL}/${LANG}/article/${c.slug}`,
        title: c.title,
        content: articleHtmlToText(c.content ?? "", c.lead ?? ""),
        category: e.article.categoryId != null ? categoryTitle.get(e.article.categoryId) ?? null : null,
      });
      stats.fetched++;
    } catch (err) {
      stats.failed++;
      const row = bySourceId.get(Number(e.article.id));
      if (row) keepIds.add(row.id);
      log(`✗ pf_${e.article.id}: ${err}`);
    }
  }

  // ── 3. Apply in one synchronous transaction (rolled back on dry run) ───────
  const db = getDb();
  const changedIds: number[] = [];
  const apply = db.transaction(() => {
    for (const f of fetched) {
      if (!f.content) { stats.failed++; continue; }
      const result = repo.upsertKBArticle({
        url: f.url,
        source_id: f.sourceId,
        title: f.title,
        content: f.content,
        category: f.category,
        content_hash: computeHash(f.content),
        source_modified_at: f.modifiedAt,
      });
      stats[result.action]++;
      keepIds.add(result.articleId);
      if (result.action !== "unchanged") {
        changedIds.push(result.articleId);
        log(`✓ ${result.action}: "${f.title}"`);
      }
    }
    // Anything stored that is no longer an eligible Product Fruits article goes away.
    for (const row of repo.getKBArticleSyncIndex()) {
      if (keepIds.has(row.id) || !row.url.startsWith(BASE_URL)) continue;
      repo.deleteKBArticle(row.id);
      stats.deleted++;
      log(`🗑 deleted: ${row.url}`);
    }
    if (dryRun) throw new DryRunRollback();
  });
  try {
    apply();
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  if (!dryRun) {
    for (const id of changedIds) repo.autoLinkTermsToArticle(id);
    if (changedIds.length > 0 || stats.deleted > 0) rebuildFtsIndexes();
  }

  log(`Product Fruits sync${dryRun ? " (dry run, nothing written)" : ""}: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.deleted} deleted, ${stats.failed} failed`);
  return stats;
}

class DryRunRollback extends Error {}
