import type Database from "better-sqlite3";
import crypto from "crypto";
import { getDb, type Ticket, type QAPair, type Category, type SyncState, type Term, type KBArticle, type CorrectionLog, type BehavioralCard, type RefDoc, type RefDocSection } from "./index";

export class Repository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDb();
  }

  // ─── Tickets ──────────────────────────────────────────────────────────────

  upsertTicket(data: {
    hubspot_id: string;
    subject?: string | null;
    content?: string | null;
    channel?: string | null;
    status?: string | null;
    priority?: string | null;
    hubspot_created_at?: number | null;
    hubspot_updated_at?: number | null;
  }): Ticket {
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE hubspot_id = ?")
      .get(data.hubspot_id) as Ticket | undefined;

    if (existing) {
      // Reset processed_at if ticket was updated in HubSpot so it gets re-processed
      const updatedChanged = data.hubspot_updated_at && data.hubspot_updated_at !== existing.hubspot_updated_at;
      this.db
        .prepare(
          `UPDATE tickets SET subject=?, content=?, channel=?, status=?, priority=?,
           hubspot_created_at=?, hubspot_updated_at=?${updatedChanged ? ", processed_at=NULL" : ""} WHERE hubspot_id=?`
        )
        .run(
          data.subject ?? null,
          data.content ?? null,
          data.channel ?? null,
          data.status ?? null,
          data.priority ?? null,
          data.hubspot_created_at ?? null,
          data.hubspot_updated_at ?? null,
          data.hubspot_id
        );
      return this.db
        .prepare("SELECT * FROM tickets WHERE hubspot_id = ?")
        .get(data.hubspot_id) as Ticket;
    }

    const info = this.db
      .prepare(
        `INSERT INTO tickets (hubspot_id, subject, content, channel, status, priority,
         hubspot_created_at, hubspot_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.hubspot_id,
        data.subject ?? null,
        data.content ?? null,
        data.channel ?? null,
        data.status ?? null,
        data.priority ?? null,
        data.hubspot_created_at ?? null,
        data.hubspot_updated_at ?? null
      );

    return this.db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(info.lastInsertRowid) as Ticket;
  }

  getUnprocessedTickets(): Ticket[] {
    return this.db
      .prepare("SELECT * FROM tickets WHERE processed_at IS NULL ORDER BY created_at ASC")
      .all() as Ticket[];
  }

  markTicketProcessed(id: number): void {
    this.db
      .prepare("UPDATE tickets SET processed_at = unixepoch() WHERE id = ?")
      .run(id);
  }

  getTicketByHubspotId(hubspotId: string): Ticket | undefined {
    return this.db
      .prepare("SELECT * FROM tickets WHERE hubspot_id = ?")
      .get(hubspotId) as Ticket | undefined;
  }

  countTickets(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM tickets").get() as { n: number };
    return row.n;
  }

  // ─── Q&A Pairs ────────────────────────────────────────────────────────────

  createQAPair(data: {
    ticket_id: number;
    question: string;
    question_template?: string | null;
    question_variables?: string | null;
    answer?: string | null;
    resolution_steps?: string | null;
    summary?: string | null;
    resolved?: boolean;
    channel?: string | null;
  }): QAPair {
    const info = this.db
      .prepare(
        `INSERT INTO qa_pairs (ticket_id, question, question_template, question_variables,
         answer, resolution_steps, summary, resolved, channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.ticket_id,
        data.question,
        data.question_template ?? null,
        data.question_variables ?? null,
        data.answer ?? null,
        data.resolution_steps ?? null,
        data.summary ?? null,
        data.resolved ? 1 : 0,
        data.channel ?? null
      );

    return this.db
      .prepare("SELECT * FROM qa_pairs WHERE id = ?")
      .get(info.lastInsertRowid) as QAPair;
  }

  getAllQAPairs(limit?: number): QAPair[] {
    const sql = limit
      ? `SELECT * FROM qa_pairs ORDER BY created_at DESC LIMIT ${limit}`
      : "SELECT * FROM qa_pairs ORDER BY created_at DESC";
    return this.db.prepare(sql).all() as QAPair[];
  }

  getQAPairsWithoutCategories(): QAPair[] {
    return this.db
      .prepare(
        `SELECT * FROM qa_pairs WHERE id NOT IN
         (SELECT qa_id FROM qa_category_map)`
      )
      .all() as QAPair[];
  }

  countQAPairs(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM qa_pairs").get() as { n: number };
    return row.n;
  }

  getQAPairById(id: number): QAPair | undefined {
    return this.db
      .prepare("SELECT * FROM qa_pairs WHERE id = ?")
      .get(id) as QAPair | undefined;
  }

  getQAPairWithCategory(id: number): (QAPair & { category_name?: string }) | undefined {
    return this.db
      .prepare(
        `SELECT q.*, c.name as category_name
         FROM qa_pairs q
         LEFT JOIN qa_category_map m ON q.id = m.qa_id
         LEFT JOIN categories c ON m.category_id = c.id
         WHERE q.id = ?`
      )
      .get(id) as (QAPair & { category_name?: string }) | undefined;
  }

  getQAPairsByTicketId(ticketId: number): QAPair[] {
    return this.db
      .prepare("SELECT * FROM qa_pairs WHERE ticket_id = ? ORDER BY created_at ASC")
      .all(ticketId) as QAPair[];
  }

  updateQAPair(id: number, fields: Partial<Pick<QAPair, "question" | "question_template" | "question_variables" | "answer" | "resolution_steps" | "summary" | "resolved" | "channel">>): QAPair {
    const allowed = ["question", "question_template", "question_variables", "answer", "resolution_steps", "summary", "resolved", "channel"] as const;
    const entries = Object.entries(fields).filter(([k]) => (allowed as readonly string[]).includes(k));
    if (entries.length === 0) return this.getQAPairById(id)!;

    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v ?? null);

    this.db
      .prepare(`UPDATE qa_pairs SET ${sets}, updated_at = unixepoch() WHERE id = ?`)
      .run(...values, id);

    return this.getQAPairById(id)!;
  }

  // ─── Search helpers ─────────────────────────────────────────────────────

  private static readonly STOP_WORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one",
    "our", "out", "has", "have", "how", "does", "what", "when", "where", "which", "who",
    "why", "this", "that", "with", "from", "they", "been", "will", "more", "some",
    "than", "them", "then", "into", "could", "would", "should", "about", "there",
    "their", "being", "also", "just", "only", "very", "after",
  ]);

  /** Build a safe FTS5 MATCH query from user input.
   *  Uses OR between terms so partial matches work — BM25 ranks by relevance.
   *  Adjacent word pairs are added as phrase boosts. */
  private buildFtsQuery(query: string): string | null {
    const words = query
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !Repository.STOP_WORDS.has(w.toLowerCase()))
      .map((w) => w.toLowerCase());
    if (words.length === 0) return null;

    // OR between individual terms — partial matches rank lower via BM25
    const parts: string[] = words.map((w) => `"${w}"`);

    // Add adjacent 2-word phrases as extra boost terms
    for (let i = 0; i < words.length - 1; i++) {
      parts.push(`"${words[i]} ${words[i + 1]}"`);
    }

    return parts.join(" OR ");
  }

  // ─── Keyword-based search (used by both KB search panel and agent) ──────

  searchQAPairs(query: string, categoryId?: number, limit = 20, offset = 0): Array<QAPair & { category_name?: string; category_id?: number }> {
    return this.searchByKeywords(query, limit, categoryId, offset);
  }

  searchByKeywords(query: string, limit = 15, categoryId?: number, offset = 0): Array<QAPair & { category_name?: string; category_id?: number; score: number }> {
    const ftsQuery = this.buildFtsQuery(query);

    // No query text — return by category or recent
    if (!ftsQuery) {
      if (categoryId) {
        return this.db
          .prepare(
            `SELECT q.*, t.hubspot_id, c.name as category_name, c.id as category_id, 0 as score
             FROM qa_pairs q
             JOIN tickets t ON q.ticket_id = t.id
             LEFT JOIN qa_category_map m ON q.id = m.qa_id
             LEFT JOIN categories c ON m.category_id = c.id
             WHERE m.category_id = ?
             GROUP BY q.id
             ORDER BY q.created_at DESC LIMIT ? OFFSET ?`
          )
          .all(categoryId, limit, offset) as Array<QAPair & { hubspot_id?: string; category_name?: string; category_id?: number; score: number }>;
      }
      return this.getRecentQA(limit, offset) as Array<QAPair & { hubspot_id?: string; category_name?: string; category_id?: number; score: number }>;
    }

    // FTS5 + BM25: subquery gets scored rowids, outer query joins metadata
    // bm25() returns negative values (lower = better match)
    const categoryFilter = categoryId ? "AND m.category_id = ?" : "";

    const sql = `SELECT q.*, t.hubspot_id, c.name as category_name, c.id as category_id, ranked.score
      FROM (
        SELECT fts.rowid as id, bm25(qa_pairs_fts, 5.0, 2.0, 1.0, 3.0) as score
        FROM qa_pairs_fts fts
        WHERE qa_pairs_fts MATCH ?
        ORDER BY score ASC
        LIMIT ?
      ) ranked
      JOIN qa_pairs q ON q.id = ranked.id
      JOIN tickets t ON q.ticket_id = t.id
      LEFT JOIN qa_category_map m ON q.id = m.qa_id ${categoryFilter}
      LEFT JOIN categories c ON m.category_id = c.id
      GROUP BY q.id
      ORDER BY ranked.score ASC
      LIMIT ? OFFSET ?`;

    // Inner limit is generous to allow category filter to narrow down
    const innerLimit = categoryId ? limit * 5 : limit + offset;
    const params: (string | number)[] = [ftsQuery, innerLimit];
    if (categoryId) params.push(categoryId);
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as Array<QAPair & { category_name?: string; category_id?: number; score: number }>;
  }

  getAllQAWithCategories(): Array<{
    id: number;
    question: string;
    question_template: string | null;
    answer: string | null;
    resolved: number;
    categories: string[];
  }> {
    const pairs = this.db
      .prepare("SELECT id, question, question_template, answer, resolved FROM qa_pairs")
      .all() as { id: number; question: string; question_template: string | null; answer: string | null; resolved: number }[];

    return pairs.map((qa) => {
      const cats = this.db
        .prepare(
          `SELECT c.name FROM categories c
           JOIN qa_category_map m ON c.id = m.category_id
           WHERE m.qa_id = ?`
        )
        .all(qa.id) as { name: string }[];

      return { ...qa, categories: cats.map((c) => c.name) };
    });
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  getAllCategories(): Category[] {
    return this.db
      .prepare("SELECT * FROM categories ORDER BY qa_count DESC, name ASC")
      .all() as Category[];
  }

  getCategoryByName(name: string): Category | undefined {
    return this.db
      .prepare("SELECT * FROM categories WHERE lower(name) = lower(?)")
      .get(name) as Category | undefined;
  }

  getOrCreateCategory(name: string, description?: string): Category {
    const existing = this.getCategoryByName(name);
    if (existing) return existing;

    const info = this.db
      .prepare("INSERT INTO categories (name, description) VALUES (?, ?)")
      .run(name, description ?? null);

    return this.db
      .prepare("SELECT * FROM categories WHERE id = ?")
      .get(info.lastInsertRowid) as Category;
  }

  assignCategory(qaId: number, categoryId: number, confidence = 1.0): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO qa_category_map (qa_id, category_id, confidence)
         VALUES (?, ?, ?)`
      )
      .run(qaId, categoryId, confidence);
  }

  refreshCategoryCounts(): void {
    this.db.prepare("UPDATE categories SET qa_count = 0").run();
    const counts = this.db
      .prepare(
        `SELECT category_id, COUNT(*) as n FROM qa_category_map GROUP BY category_id`
      )
      .all() as { category_id: number; n: number }[];

    for (const row of counts) {
      this.db
        .prepare("UPDATE categories SET qa_count = ?, updated_at = unixepoch() WHERE id = ?")
        .run(row.n, row.category_id);
    }
  }

  clearAllCategoryAssignments(): void {
    this.db.prepare("DELETE FROM qa_category_map").run();
    this.db.prepare("DELETE FROM categories").run();
  }

  getCategorySummary(): Array<{
    id: number;
    name: string;
    description: string | null;
    count: number;
    examples: string[];
  }> {
    const cats = this.db
      .prepare(
        `SELECT c.*, COUNT(m.qa_id) as live_count
         FROM categories c
         LEFT JOIN qa_category_map m ON c.id = m.category_id
         GROUP BY c.id
         ORDER BY live_count DESC, c.name ASC`
      )
      .all() as (Category & { live_count: number })[];

    return cats.map((cat) => {
      const examples = this.db
        .prepare(
          `SELECT q.question FROM qa_pairs q
           JOIN qa_category_map m ON q.id = m.qa_id
           WHERE m.category_id = ? LIMIT 3`
        )
        .all(cat.id) as { question: string }[];

      return {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        count: cat.live_count,
        examples: examples.map((e) => e.question),
      };
    });
  }

  getRecentQA(limit = 8, offset = 0): Array<QAPair & { hubspot_id?: string; category_name?: string }> {
    return this.db
      .prepare(
        `SELECT q.*, t.hubspot_id, c.name as category_name
         FROM qa_pairs q
         JOIN tickets t ON q.ticket_id = t.id
         LEFT JOIN qa_category_map m ON q.id = m.qa_id
         LEFT JOIN categories c ON m.category_id = c.id
         GROUP BY q.id
         ORDER BY q.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Array<QAPair & { hubspot_id?: string; category_name?: string }>;
  }

  // ─── Sync State ───────────────────────────────────────────────────────────

  getSyncState(): SyncState {
    let state = this.db.prepare("SELECT * FROM sync_state LIMIT 1").get() as SyncState | undefined;
    if (!state) {
      this.db
        .prepare(
          `INSERT INTO sync_state (tickets_synced_total, qa_pairs_total, new_qa_since_recluster)
           VALUES (0, 0, 0)`
        )
        .run();
      state = this.db.prepare("SELECT * FROM sync_state LIMIT 1").get() as SyncState;
    }
    return state;
  }

  updateSyncState(data: Partial<Omit<SyncState, "id">>): void {
    const state = this.getSyncState();
    const fields = Object.entries(data)
      .map(([k]) => `${k} = ?`)
      .join(", ");
    const values = Object.values(data);

    this.db
      .prepare(`UPDATE sync_state SET ${fields} WHERE id = ?`)
      .run(...values, state.id);
  }

  // ─── Terms (Glossary) ─────────────────────────────────────────────────────

  createTerm(data: { name: string; definition: string; aliases?: string[] }): Term {
    const info = this.db
      .prepare("INSERT INTO terms (name, definition, aliases) VALUES (?, ?, ?)")
      .run(data.name, data.definition, JSON.stringify(data.aliases ?? []));
    return this.db.prepare("SELECT * FROM terms WHERE id = ?").get(info.lastInsertRowid) as Term;
  }

  updateTerm(id: number, fields: Partial<Pick<Term, "name" | "definition"> & { aliases: string[] }>): Term {
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); values.push(fields.name); }
    if (fields.definition !== undefined) { sets.push("definition = ?"); values.push(fields.definition); }
    if (fields.aliases !== undefined) { sets.push("aliases = ?"); values.push(JSON.stringify(fields.aliases)); }
    if (sets.length > 0) {
      sets.push("updated_at = unixepoch()");
      this.db.prepare(`UPDATE terms SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    }
    return this.db.prepare("SELECT * FROM terms WHERE id = ?").get(id) as Term;
  }

  deleteTerm(id: number): void {
    this.db.prepare("DELETE FROM terms WHERE id = ?").run(id);
  }

  getTermById(id: number): Term | undefined {
    return this.db.prepare("SELECT * FROM terms WHERE id = ?").get(id) as Term | undefined;
  }

  getAllTerms(): Term[] {
    return this.db.prepare("SELECT * FROM terms ORDER BY name ASC").all() as Term[];
  }

  searchTerms(query: string): Term[] {
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !Repository.STOP_WORDS.has(w));
    if (words.length === 0) return this.getAllTerms();

    const conditions = words.map(() =>
      `(CASE WHEN LOWER(t.name) LIKE ? THEN 3 ELSE 0 END + CASE WHEN LOWER(t.definition) LIKE ? THEN 1 ELSE 0 END + CASE WHEN LOWER(t.aliases) LIKE ? THEN 2 ELSE 0 END)`
    );
    const scoreExpr = conditions.join(" + ");

    const sql = `SELECT t.*, (${scoreExpr}) as score FROM terms t WHERE score > 0 ORDER BY score DESC, t.name ASC`;
    const params: string[] = [];
    for (const w of words) {
      const like = `%${w}%`;
      params.push(like, like, like);
    }
    return this.db.prepare(sql).all(...params) as Term[];
  }

  getTermsForQA(qaId: number): Term[] {
    return this.db
      .prepare(
        `SELECT t.* FROM terms t
         JOIN term_qa_map m ON t.id = m.term_id
         WHERE m.qa_id = ? ORDER BY t.name ASC`
      )
      .all(qaId) as Term[];
  }

  getQAsForTerm(termId: number): QAPair[] {
    return this.db
      .prepare(
        `SELECT q.* FROM qa_pairs q
         JOIN term_qa_map m ON q.id = m.qa_id
         WHERE m.term_id = ? ORDER BY q.created_at DESC`
      )
      .all(termId) as QAPair[];
  }

  linkTermToQA(termId: number, qaId: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO term_qa_map (term_id, qa_id) VALUES (?, ?)")
      .run(termId, qaId);
  }

  unlinkTermFromQA(termId: number, qaId: number): void {
    this.db
      .prepare("DELETE FROM term_qa_map WHERE term_id = ? AND qa_id = ?")
      .run(termId, qaId);
  }

  autoLinkTermsToQA(qaId: number): void {
    const qa = this.getQAPairById(qaId);
    if (!qa) return;
    const text = [qa.question, qa.answer, qa.summary].filter(Boolean).join(" ").toLowerCase();
    const terms = this.getAllTerms();

    for (const term of terms) {
      const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]];
      const found = names.some((n) => text.includes(n.toLowerCase()));
      if (found) this.linkTermToQA(term.id, qaId);
    }
  }

  autoLinkTermToAll(termId: number): void {
    this.autoLinkTermToAllQAs(termId);
    this.autoLinkTermToAllArticles(termId);
  }

  autoLinkTermToAllQAs(termId: number): void {
    const term = this.getTermById(termId);
    if (!term) return;
    const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]].map((n) => n.toLowerCase());

    // Clear existing links for this term and rebuild
    this.db.prepare("DELETE FROM term_qa_map WHERE term_id = ?").run(termId);

    const allQAs = this.db.prepare("SELECT id, question, answer, summary FROM qa_pairs").all() as QAPair[];
    for (const qa of allQAs) {
      const text = [qa.question, qa.answer, qa.summary].filter(Boolean).join(" ").toLowerCase();
      if (names.some((n) => text.includes(n))) {
        this.linkTermToQA(termId, qa.id);
      }
    }
  }

  linkTermToArticle(termId: number, articleId: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO term_article_map (term_id, article_id) VALUES (?, ?)")
      .run(termId, articleId);
  }

  autoLinkTermsToArticle(articleId: number): void {
    const article = this.db.prepare("SELECT id, title, content FROM kb_articles WHERE id = ?").get(articleId) as KBArticle | undefined;
    if (!article) return;
    const text = [article.title, article.content].join(" ").toLowerCase();
    const terms = this.getAllTerms();

    for (const term of terms) {
      const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]];
      if (names.some((n) => text.includes(n.toLowerCase()))) {
        this.linkTermToArticle(term.id, articleId);
      }
    }
  }

  autoLinkTermToAllArticles(termId: number): void {
    const term = this.getTermById(termId);
    if (!term) return;
    const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]].map((n) => n.toLowerCase());

    this.db.prepare("DELETE FROM term_article_map WHERE term_id = ?").run(termId);

    const allArticles = this.db.prepare("SELECT id, title, content FROM kb_articles").all() as KBArticle[];
    for (const article of allArticles) {
      const text = [article.title, article.content].join(" ").toLowerCase();
      if (names.some((n) => text.includes(n))) {
        this.linkTermToArticle(termId, article.id);
      }
    }
  }

  getArticlesForTerm(termId: number): KBArticle[] {
    return this.db
      .prepare(
        `SELECT a.* FROM kb_articles a
         JOIN term_article_map m ON a.id = m.article_id
         WHERE m.term_id = ? ORDER BY a.title ASC`
      )
      .all(termId) as KBArticle[];
  }

  getTermsForArticle(articleId: number): Term[] {
    return this.db
      .prepare(
        `SELECT t.* FROM terms t
         JOIN term_article_map m ON t.id = m.term_id
         WHERE m.article_id = ? ORDER BY t.name ASC`
      )
      .all(articleId) as Term[];
  }

  countTerms(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM terms").get() as { n: number };
    return row.n;
  }

  getTermQACount(termId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM term_qa_map WHERE term_id = ?").get(termId) as { n: number };
    return row.n;
  }

  getTermArticleCount(termId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM term_article_map WHERE term_id = ?").get(termId) as { n: number };
    return row.n;
  }

  getAllTermsWithCounts(): Array<Term & { qa_count: number; article_count: number }> {
    return this.db
      .prepare(
        `SELECT t.*,
           (SELECT COUNT(*) FROM term_qa_map WHERE term_id = t.id) as qa_count,
           (SELECT COUNT(*) FROM term_article_map WHERE term_id = t.id) as article_count
         FROM terms t
         ORDER BY t.name ASC`
      )
      .all() as Array<Term & { qa_count: number; article_count: number }>;
  }

  // ─── KB Articles ──────────────────────────────────────────────────────────

  upsertKBArticle(data: {
    url: string;
    title: string;
    content: string;
    category: string | null;
    content_hash: string;
  }): { action: "created" | "updated" | "unchanged"; articleId: number } {
    const existing = this.db
      .prepare("SELECT id, content_hash FROM kb_articles WHERE url = ?")
      .get(data.url) as { id: number; content_hash: string } | undefined;

    if (existing) {
      if (existing.content_hash === data.content_hash) return { action: "unchanged", articleId: existing.id };
      this.db
        .prepare(
          `UPDATE kb_articles SET title=?, content=?, category=?, content_hash=?, scraped_at=unixepoch() WHERE id=?`
        )
        .run(data.title, data.content, data.category, data.content_hash, existing.id);
      return { action: "updated", articleId: existing.id };
    }

    const info = this.db
      .prepare(
        `INSERT INTO kb_articles (url, title, content, category, content_hash) VALUES (?, ?, ?, ?, ?)`
      )
      .run(data.url, data.title, data.content, data.category, data.content_hash);
    return { action: "created", articleId: Number(info.lastInsertRowid) };
  }

  getAllKBArticles(): KBArticle[] {
    return this.db
      .prepare("SELECT * FROM kb_articles ORDER BY category ASC, title ASC")
      .all() as KBArticle[];
  }

  searchKBArticles(query: string, limit = 10, offset = 0): KBArticle[] {
    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) {
      return this.db
        .prepare("SELECT * FROM kb_articles ORDER BY title ASC LIMIT ? OFFSET ?")
        .all(limit, offset) as KBArticle[];
    }

    // FTS5 + BM25: weights = title(5), content(1)
    const sql = `SELECT a.*, bm25(kb_articles_fts, 5.0, 1.0) as score
      FROM kb_articles_fts fts
      JOIN kb_articles a ON a.id = fts.rowid
      WHERE kb_articles_fts MATCH ?
      ORDER BY score ASC
      LIMIT ? OFFSET ?`;

    return this.db.prepare(sql).all(ftsQuery, limit, offset) as KBArticle[];
  }

  getKBArticleCategories(): Array<{ category: string; count: number }> {
    return this.db
      .prepare(
        `SELECT category, COUNT(*) as count FROM kb_articles
         WHERE category IS NOT NULL
         GROUP BY category ORDER BY count DESC`
      )
      .all() as Array<{ category: string; count: number }>;
  }

  countKBArticles(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM kb_articles").get() as { n: number };
    return row.n;
  }

  getMatchingTermsForQuery(query: string): Term[] {
    const lower = query.toLowerCase();
    const terms = this.getAllTerms();
    return terms.filter((term) => {
      const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]];
      return names.some((n) => lower.includes(n.toLowerCase()));
    });
  }

  // --- Correction Logs ---

  createCorrectionLog(data: {
    qa_id: number;
    agent_question: string;
    agent_answer: string;
    user_feedback: string;
    field_name: string;
    old_value: string | null;
    new_value: string | null;
  }): CorrectionLog {
    const stmt = this.db.prepare(
      `INSERT INTO correction_logs (qa_id, agent_question, agent_answer, user_feedback, field_name, old_value, new_value)
       VALUES (@qa_id, @agent_question, @agent_answer, @user_feedback, @field_name, @old_value, @new_value)`
    );
    const info = stmt.run(data);
    return this.db
      .prepare("SELECT * FROM correction_logs WHERE id = ?")
      .get(info.lastInsertRowid) as CorrectionLog;
  }

  getCorrectionLogsForQA(qaId: number): CorrectionLog[] {
    return this.db
      .prepare("SELECT * FROM correction_logs WHERE qa_id = ? ORDER BY created_at DESC")
      .all(qaId) as CorrectionLog[];
  }

  getRecentCorrectionLogs(limit = 50): CorrectionLog[] {
    return this.db
      .prepare("SELECT * FROM correction_logs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as CorrectionLog[];
  }

  countCorrectionLogs(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM correction_logs").get() as { n: number };
    return row.n;
  }

  // --- Behavioral Cards ---

  createBehavioralCard(data: {
    title: string;
    instruction: string;
    type: "knowledge" | "solution" | "general";
    scope: "global" | "category";
    category_id?: number | null;
    source?: string;
    correction_log_id?: number | null;
  }): BehavioralCard {
    const stmt = this.db.prepare(
      `INSERT INTO behavioral_cards (title, instruction, type, scope, category_id, source, correction_log_id)
       VALUES (@title, @instruction, @type, @scope, @category_id, @source, @correction_log_id)`
    );
    const info = stmt.run({
      title: data.title,
      instruction: data.instruction,
      type: data.type,
      scope: data.scope,
      category_id: data.category_id ?? null,
      source: data.source ?? "manual",
      correction_log_id: data.correction_log_id ?? null,
    });
    return this.db
      .prepare("SELECT * FROM behavioral_cards WHERE id = ?")
      .get(info.lastInsertRowid) as BehavioralCard;
  }

  updateBehavioralCard(
    id: number,
    fields: Partial<Pick<BehavioralCard, "title" | "instruction" | "type" | "scope" | "category_id" | "active">>
  ): BehavioralCard {
    const sets: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${key} = @${key}`);
        values[key] = val;
      }
    }
    if (sets.length === 0) return this.getBehavioralCardById(id)!;

    sets.push("updated_at = unixepoch()");
    this.db.prepare(`UPDATE behavioral_cards SET ${sets.join(", ")} WHERE id = @id`).run(values);
    return this.getBehavioralCardById(id)!;
  }

  deleteBehavioralCard(id: number): void {
    this.db.prepare("DELETE FROM behavioral_cards WHERE id = ?").run(id);
  }

  getBehavioralCardById(id: number): BehavioralCard | undefined {
    return this.db
      .prepare("SELECT * FROM behavioral_cards WHERE id = ?")
      .get(id) as BehavioralCard | undefined;
  }

  getAllBehavioralCards(): Array<BehavioralCard & { category_name?: string }> {
    return this.db
      .prepare(
        `SELECT b.*, c.name as category_name
         FROM behavioral_cards b
         LEFT JOIN categories c ON b.category_id = c.id
         ORDER BY b.scope ASC, b.created_at DESC`
      )
      .all() as Array<BehavioralCard & { category_name?: string }>;
  }

  getGlobalBehavioralCards(): BehavioralCard[] {
    return this.db
      .prepare("SELECT * FROM behavioral_cards WHERE scope = 'global' AND active = 1 ORDER BY created_at ASC")
      .all() as BehavioralCard[];
  }

  getBehavioralCardsForCategories(categoryIds: number[]): BehavioralCard[] {
    if (categoryIds.length === 0) return [];
    const placeholders = categoryIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM behavioral_cards
         WHERE scope = 'category' AND active = 1 AND category_id IN (${placeholders})
         ORDER BY created_at ASC`
      )
      .all(...categoryIds) as BehavioralCard[];
  }

  countBehavioralCards(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM behavioral_cards").get() as { n: number };
    return row.n;
  }

  // ─── Reference Documents ────────────────────────────────────────────────────

  createRefDoc(data: { title: string; source_type: "google_doc" | "manual"; source_url?: string | null }): RefDoc {
    const info = this.db
      .prepare("INSERT INTO ref_docs (title, source_type, source_url) VALUES (?, ?, ?)")
      .run(data.title, data.source_type, data.source_url ?? null);
    return this.db.prepare("SELECT * FROM ref_docs WHERE id = ?").get(Number(info.lastInsertRowid)) as RefDoc;
  }

  updateRefDoc(id: number, fields: Partial<Pick<RefDoc, "title" | "active">>): RefDoc | undefined {
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (fields.title !== undefined) { sets.push("title = ?"); vals.push(fields.title); }
    if (fields.active !== undefined) { sets.push("active = ?"); vals.push(fields.active); }
    if (sets.length === 0) return this.getRefDocById(id);
    sets.push("updated_at = unixepoch()");
    vals.push(id);
    this.db.prepare(`UPDATE ref_docs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return this.getRefDocById(id);
  }

  deleteRefDoc(id: number): void {
    this.db.prepare("DELETE FROM ref_docs WHERE id = ?").run(id);
  }

  getRefDocById(id: number): RefDoc | undefined {
    return this.db.prepare("SELECT * FROM ref_docs WHERE id = ?").get(id) as RefDoc | undefined;
  }

  getAllRefDocs(): Array<RefDoc & { section_count: number }> {
    return this.db
      .prepare(
        `SELECT rd.*, (SELECT COUNT(*) FROM ref_doc_sections WHERE doc_id = rd.id) as section_count
         FROM ref_docs rd ORDER BY rd.created_at DESC`
      )
      .all() as Array<RefDoc & { section_count: number }>;
  }

  countRefDocs(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM ref_docs").get() as { n: number };
    return row.n;
  }

  // ─── Reference Document Sections ────────────────────────────────────────────

  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  createRefDocSection(data: { doc_id: number; heading: string; content: string; section_order?: number }): RefDocSection {
    const order = data.section_order ?? 0;
    const hash = this.hashContent(data.content);
    const info = this.db
      .prepare("INSERT INTO ref_doc_sections (doc_id, heading, content, section_order, content_hash) VALUES (?, ?, ?, ?, ?)")
      .run(data.doc_id, data.heading, data.content, order, hash);
    return this.db.prepare("SELECT * FROM ref_doc_sections WHERE id = ?").get(Number(info.lastInsertRowid)) as RefDocSection;
  }

  updateRefDocSection(id: number, fields: Partial<Pick<RefDocSection, "heading" | "content" | "section_order">>): RefDocSection | undefined {
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (fields.heading !== undefined) { sets.push("heading = ?"); vals.push(fields.heading); }
    if (fields.content !== undefined) { sets.push("content = ?"); vals.push(fields.content); sets.push("content_hash = ?"); vals.push(this.hashContent(fields.content)); }
    if (fields.section_order !== undefined) { sets.push("section_order = ?"); vals.push(fields.section_order); }
    if (sets.length === 0) return this.db.prepare("SELECT * FROM ref_doc_sections WHERE id = ?").get(id) as RefDocSection | undefined;
    sets.push("updated_at = unixepoch()");
    vals.push(id);
    this.db.prepare(`UPDATE ref_doc_sections SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return this.db.prepare("SELECT * FROM ref_doc_sections WHERE id = ?").get(id) as RefDocSection | undefined;
  }

  deleteRefDocSection(id: number): void {
    this.db.prepare("DELETE FROM ref_doc_sections WHERE id = ?").run(id);
  }

  getRefDocSections(docId: number): RefDocSection[] {
    return this.db
      .prepare("SELECT * FROM ref_doc_sections WHERE doc_id = ? ORDER BY section_order ASC")
      .all(docId) as RefDocSection[];
  }

  clearRefDocSections(docId: number): void {
    this.db.prepare("DELETE FROM ref_doc_sections WHERE doc_id = ?").run(docId);
  }

  searchRefDocSections(query: string, limit = 8): Array<RefDocSection & { doc_title: string }> {
    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) return [];

    // FTS5 + BM25: weights = heading(5), content(1)
    // Only active docs — filter via JOIN
    const sql = `SELECT s.*, rd.title as doc_title, bm25(ref_doc_sections_fts, 5.0, 1.0) as score
      FROM ref_doc_sections_fts fts
      JOIN ref_doc_sections s ON s.id = fts.rowid
      JOIN ref_docs rd ON rd.id = s.doc_id
      WHERE ref_doc_sections_fts MATCH ? AND rd.active = 1
      ORDER BY score ASC
      LIMIT ?`;

    return this.db.prepare(sql).all(ftsQuery, limit) as Array<RefDocSection & { doc_title: string }>;
  }
}
