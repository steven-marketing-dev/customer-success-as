import type Database from "better-sqlite3";
import crypto from "crypto";
import { getDb, type Ticket, type QAPair, type Category, type SyncState, type Term, type KBArticle, type CorrectionLog, type BehavioralCard, type RefDoc, type RefDocSection, type User, type Conversation, type ChatMessage, type MessageRating, type ProcessCard, type TourCompletion, type GmailToken, type WidgetInstallation, type WidgetRating, type WidgetQuestion, type WidgetArticleClick, type ClarityMetric, type WidgetEventType } from "./index";

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, " ").trim().slice(0, 200);
}

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
    contact_id?: string | null;
    contact_email?: string | null;
    contact_name?: string | null;
    company_id?: string | null;
    company_name?: string | null;
  }): Ticket {
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE hubspot_id = ?")
      .get(data.hubspot_id) as Ticket | undefined;

    if (existing) {
      // Reset processed_at if ticket was updated in HubSpot so it gets re-processed
      const updatedChanged = data.hubspot_updated_at && data.hubspot_updated_at !== existing.hubspot_updated_at;
      // Preserve existing association fields when caller didn't provide them (undefined)
      const contactId = data.contact_id === undefined ? existing.contact_id : data.contact_id;
      const contactEmail = data.contact_email === undefined ? existing.contact_email : data.contact_email;
      const contactName = data.contact_name === undefined ? existing.contact_name : data.contact_name;
      const companyId = data.company_id === undefined ? existing.company_id : data.company_id;
      const companyName = data.company_name === undefined ? existing.company_name : data.company_name;
      this.db
        .prepare(
          `UPDATE tickets SET subject=?, content=?, channel=?, status=?, priority=?,
           hubspot_created_at=?, hubspot_updated_at=?,
           contact_id=?, contact_email=?, contact_name=?, company_id=?, company_name=?${updatedChanged ? ", processed_at=NULL" : ""} WHERE hubspot_id=?`
        )
        .run(
          data.subject ?? null,
          data.content ?? null,
          data.channel ?? null,
          data.status ?? null,
          data.priority ?? null,
          data.hubspot_created_at ?? null,
          data.hubspot_updated_at ?? null,
          contactId,
          contactEmail,
          contactName,
          companyId,
          companyName,
          data.hubspot_id
        );
      return this.db
        .prepare("SELECT * FROM tickets WHERE hubspot_id = ?")
        .get(data.hubspot_id) as Ticket;
    }

    const info = this.db
      .prepare(
        `INSERT INTO tickets (hubspot_id, subject, content, channel, status, priority,
         hubspot_created_at, hubspot_updated_at,
         contact_id, contact_email, contact_name, company_id, company_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.hubspot_id,
        data.subject ?? null,
        data.content ?? null,
        data.channel ?? null,
        data.status ?? null,
        data.priority ?? null,
        data.hubspot_created_at ?? null,
        data.hubspot_updated_at ?? null,
        data.contact_id ?? null,
        data.contact_email ?? null,
        data.contact_name ?? null,
        data.company_id ?? null,
        data.company_name ?? null
      );

    return this.db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(info.lastInsertRowid) as Ticket;
  }

  setTicketAssociations(ticketId: number, data: {
    contact_id: string | null;
    contact_email: string | null;
    contact_name: string | null;
    company_id: string | null;
    company_name: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE tickets SET contact_id=?, contact_email=?, contact_name=?, company_id=?, company_name=? WHERE id=?`
      )
      .run(
        data.contact_id,
        data.contact_email,
        data.contact_name,
        data.company_id,
        data.company_name,
        ticketId
      );
  }

  getTicketsMissingAssociations(): Ticket[] {
    return this.db
      .prepare("SELECT * FROM tickets WHERE contact_email IS NULL ORDER BY hubspot_created_at DESC")
      .all() as Ticket[];
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
    root_cause?: string | null;
  }): QAPair {
    const info = this.db
      .prepare(
        `INSERT INTO qa_pairs (ticket_id, question, question_template, question_variables,
         answer, resolution_steps, summary, resolved, channel, root_cause)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        data.channel ?? null,
        data.root_cause ?? null
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

  updateQAPair(id: number, fields: Partial<Pick<QAPair, "question" | "question_template" | "question_variables" | "answer" | "resolution_steps" | "summary" | "resolved" | "channel" | "root_cause">>): QAPair {
    const allowed = ["question", "question_template", "question_variables", "answer", "resolution_steps", "summary", "resolved", "channel", "root_cause"] as const;
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
    this.autoLinkTermToAllProcessCards(termId);
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
    source_id: number | null;
    title: string;
    content: string;
    category: string | null;
    content_hash: string;
  }): { action: "created" | "updated" | "unchanged"; articleId: number } {
    // Identity priority: source_id (stable across slug changes) → url (legacy fallback).
    let existing: { id: number; content_hash: string; url: string; source_id: number | null } | undefined;
    if (data.source_id != null) {
      existing = this.db
        .prepare("SELECT id, content_hash, url, source_id FROM kb_articles WHERE source_id = ?")
        .get(data.source_id) as typeof existing;
    }
    if (!existing) {
      existing = this.db
        .prepare("SELECT id, content_hash, url, source_id FROM kb_articles WHERE url = ?")
        .get(data.url) as typeof existing;
    }

    if (existing) {
      const urlChanged = existing.url !== data.url;
      const sourceIdChanged = existing.source_id !== data.source_id && data.source_id != null;
      if (existing.content_hash === data.content_hash && !urlChanged && !sourceIdChanged) {
        return { action: "unchanged", articleId: existing.id };
      }
      this.db
        .prepare(
          `UPDATE kb_articles SET url=?, source_id=COALESCE(?, source_id), title=?, content=?, category=?, content_hash=?, scraped_at=unixepoch() WHERE id=?`
        )
        .run(data.url, data.source_id, data.title, data.content, data.category, data.content_hash, existing.id);
      return { action: "updated", articleId: existing.id };
    }

    const info = this.db
      .prepare(
        `INSERT INTO kb_articles (url, source_id, title, content, category, content_hash) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(data.url, data.source_id, data.title, data.content, data.category, data.content_hash);
    return { action: "created", articleId: Number(info.lastInsertRowid) };
  }

  /** Rows that pre-date the source_id column — used by the scraper's one-time backfill. */
  getKBArticlesMissingSourceId(): Array<{ id: number; url: string }> {
    return this.db
      .prepare("SELECT id, url FROM kb_articles WHERE source_id IS NULL")
      .all() as Array<{ id: number; url: string }>;
  }

  /** Stamp source_id onto a legacy row. Returns false if another row already owns that source_id. */
  setKBArticleSourceId(articleId: number, sourceId: number): boolean {
    try {
      this.db.prepare("UPDATE kb_articles SET source_id=? WHERE id=?").run(sourceId, articleId);
      return true;
    } catch {
      return false; // unique constraint — another row already has this source_id
    }
  }

  deleteKBArticle(articleId: number): void {
    // process_cards.source_id has no FK — clean up manually to avoid stale pointers.
    this.db.prepare("DELETE FROM process_cards WHERE source_type='article' AND source_id=?").run(articleId);
    // term_article_map cascades via FK.
    this.db.prepare("DELETE FROM kb_articles WHERE id=?").run(articleId);
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

  getBehavioralCardsForQAs(qaIds: number[]): Array<BehavioralCard & { category_name?: string }> {
    if (qaIds.length === 0) return [];
    const placeholders = qaIds.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT DISTINCT b.*, c.name as category_name
       FROM behavioral_cards b
       LEFT JOIN categories c ON b.category_id = c.id
       INNER JOIN correction_logs cl ON b.correction_log_id = cl.id
       WHERE cl.qa_id IN (${placeholders})
       ORDER BY b.created_at DESC`
    ).all(...qaIds) as Array<BehavioralCard & { category_name?: string }>;
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

  // ─── Users ────────────────────────────────────────────────────────────────

  getUserByUsername(username: string): User | undefined {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
  }

  getUserById(id: number): User | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  }

  createUser(data: { username: string; password_hash: string; display_name: string | null; role: string }): User {
    const stmt = this.db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
    );
    const info = stmt.run(data.username, data.password_hash, data.display_name, data.role);
    return this.getUserById(info.lastInsertRowid as number)!;
  }

  deleteUser(id: number): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  getAllUsers(): User[] {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as User[];
  }

  updateUserProfile(id: number, data: { calendly_url?: string | null; display_name?: string | null }): User | undefined {
    const fields: string[] = [];
    const values: (string | null | number)[] = [];

    if (data.calendly_url !== undefined) {
      fields.push("calendly_url = ?");
      values.push(data.calendly_url);
    }
    if (data.display_name !== undefined) {
      fields.push("display_name = ?");
      values.push(data.display_name);
    }

    if (fields.length === 0) return this.getUserById(id);

    values.push(id);
    this.db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getUserById(id);
  }

  // ─── Gmail Tokens ─────────────────────────────────────────────────────────

  saveGmailTokens(userId: number, data: { access_token_encrypted: string; refresh_token_encrypted: string; token_expiry: number | null; gmail_email: string | null }): void {
    this.db.prepare(`
      INSERT INTO gmail_tokens (user_id, access_token_encrypted, refresh_token_encrypted, token_expiry, gmail_email)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        access_token_encrypted = excluded.access_token_encrypted,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        token_expiry = excluded.token_expiry,
        gmail_email = excluded.gmail_email,
        updated_at = unixepoch()
    `).run(userId, data.access_token_encrypted, data.refresh_token_encrypted, data.token_expiry, data.gmail_email);
  }

  getGmailTokens(userId: number): GmailToken | undefined {
    return this.db.prepare("SELECT * FROM gmail_tokens WHERE user_id = ?").get(userId) as GmailToken | undefined;
  }

  deleteGmailTokens(userId: number): void {
    this.db.prepare("DELETE FROM gmail_tokens WHERE user_id = ?").run(userId);
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  createConversation(userId: number, title?: string): Conversation {
    const stmt = this.db.prepare(
      "INSERT INTO conversations (user_id, title) VALUES (?, ?)"
    );
    const info = stmt.run(userId, title || null);
    return this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(info.lastInsertRowid) as Conversation;
  }

  getConversation(id: number): Conversation | undefined {
    return this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
  }

  updateConversationTitle(id: number, title: string): void {
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, id);
  }

  getUserConversations(userId: number, limit = 50, offset = 0): Array<Conversation & { username: string; message_count: number }> {
    return this.db.prepare(`
      SELECT c.*, u.username, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset) as Array<Conversation & { username: string; message_count: number }>;
  }

  getAllConversations(limit = 100, offset = 0): Array<Conversation & { username: string; message_count: number }> {
    return this.db.prepare(`
      SELECT c.*, u.username, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      JOIN users u ON u.id = c.user_id
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<Conversation & { username: string; message_count: number }>;
  }

  deleteConversation(id: number): void {
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  addMessage(data: { conversation_id: number; role: string; content: string; sources_json?: string | null }): ChatMessage {
    const stmt = this.db.prepare(
      "INSERT INTO messages (conversation_id, role, content, sources_json) VALUES (?, ?, ?, ?)"
    );
    const info = stmt.run(data.conversation_id, data.role, data.content, data.sources_json || null);
    // Also update conversation's updated_at
    this.db.prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(data.conversation_id);
    return this.db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as ChatMessage;
  }

  getMessages(conversationId: number): ChatMessage[] {
    return this.db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    ).all(conversationId) as ChatMessage[];
  }

  getMessageById(id: number): ChatMessage | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as ChatMessage | undefined;
  }

  /** Get the user message immediately preceding an assistant message in the same conversation.
   *  Uses rowid (id) ordering instead of created_at to avoid ambiguity when multiple messages share the same second. */
  getPrecedingUserMessage(assistantMessageId: number): ChatMessage | undefined {
    const msg = this.getMessageById(assistantMessageId);
    if (!msg || msg.role !== "assistant") return undefined;
    return this.db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1"
    ).get(msg.conversation_id, msg.id) as ChatMessage | undefined;
  }

  // ─── Message Ratings ──────────────────────────────────────────────────────

  rateMessage(data: { message_id: number; user_id: number; rating: number; feedback?: string | null }): void {
    this.db.prepare(`
      INSERT INTO message_ratings (message_id, user_id, rating, feedback)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id, user_id) DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback
    `).run(data.message_id, data.user_id, data.rating, data.feedback || null);
  }

  getMessageRating(messageId: number, userId: number): MessageRating | undefined {
    return this.db.prepare(
      "SELECT * FROM message_ratings WHERE message_id = ? AND user_id = ?"
    ).get(messageId, userId) as MessageRating | undefined;
  }

  getRatingDistribution(): Array<{ rating: number; count: number }> {
    return this.db.prepare(
      "SELECT rating, COUNT(*) as count FROM message_ratings GROUP BY rating ORDER BY rating"
    ).all() as Array<{ rating: number; count: number }>;
  }

  getLowRatedMessages(limit = 20): Array<ChatMessage & { rating: number; feedback: string; username: string; rated_at: number }> {
    return this.db.prepare(`
      SELECT m.*, mr.rating, mr.feedback, u.username, mr.created_at as rated_at
      FROM message_ratings mr
      JOIN messages m ON m.id = mr.message_id
      JOIN users u ON u.id = mr.user_id
      WHERE mr.rating = 1 AND mr.feedback IS NOT NULL
      ORDER BY mr.created_at DESC
      LIMIT ?
    `).all(limit) as Array<ChatMessage & { rating: number; feedback: string; username: string; rated_at: number }>;
  }

  getAverageRating(): number {
    const row = this.db.prepare("SELECT AVG(rating) as avg FROM message_ratings").get() as { avg: number | null };
    return row.avg ?? 0;
  }

  getAllRatedMessages(limit = 100): Array<{
    id: number; conversation_id: number; content: string; role: string;
    rating: number; feedback: string | null; username: string; rated_at: number;
    question: string | null;
  }> {
    return this.db.prepare(`
      SELECT m.id, m.conversation_id, m.content, m.role,
             mr.rating, mr.feedback, u.username, mr.created_at as rated_at,
             (SELECT prev.content FROM messages prev
              WHERE prev.conversation_id = m.conversation_id
                AND prev.role = 'user' AND prev.id < m.id
              ORDER BY prev.id DESC LIMIT 1) as question
      FROM message_ratings mr
      JOIN messages m ON m.id = mr.message_id
      JOIN users u ON u.id = mr.user_id
      ORDER BY mr.created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: number; conversation_id: number; content: string; role: string;
      rating: number; feedback: string | null; username: string; rated_at: number;
      question: string | null;
    }>;
  }

  /** Get correction logs and behavioral cards linked to a conversation */
  getActionsForConversation(conversationId: number): {
    corrections: Array<{ id: number; qa_id: number; field_name: string; old_value: string | null; new_value: string | null; created_at: number }>;
    behavioralCards: Array<{ id: number; title: string; instruction: string; type: string; scope: string; source: string; created_at: number }>;
  } {
    // Find correction logs where agent_question matches any user message in this conversation
    const userMessages = this.db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user'"
    ).all(conversationId) as Array<{ content: string }>;

    const corrections: Array<{ id: number; qa_id: number; field_name: string; old_value: string | null; new_value: string | null; created_at: number }> = [];
    for (const msg of userMessages) {
      const logs = this.db.prepare(
        "SELECT id, qa_id, field_name, old_value, new_value, created_at FROM correction_logs WHERE agent_question = ? ORDER BY created_at DESC"
      ).all(msg.content) as typeof corrections;
      corrections.push(...logs);
    }

    // Get suggested behavioral cards linked to correction logs from this conversation
    const correctionIds = corrections.map(c => c.id);
    let behavioralCards: Array<{ id: number; title: string; instruction: string; type: string; scope: string; source: string; created_at: number }> = [];
    if (correctionIds.length > 0) {
      const placeholders = correctionIds.map(() => "?").join(",");
      behavioralCards = this.db.prepare(
        `SELECT id, title, instruction, type, scope, source, created_at FROM behavioral_cards
         WHERE correction_log_id IN (${placeholders}) ORDER BY created_at DESC`
      ).all(...correctionIds) as typeof behavioralCards;
    }

    return { corrections, behavioralCards };
  }

  getRatingsForConversation(conversationId: number): Record<number, { rating: number; feedback: string | null }> {
    const rows = this.db.prepare(`
      SELECT mr.message_id, mr.rating, mr.feedback
      FROM message_ratings mr
      JOIN messages m ON m.id = mr.message_id
      WHERE m.conversation_id = ?
    `).all(conversationId) as Array<{ message_id: number; rating: number; feedback: string | null }>;

    const map: Record<number, { rating: number; feedback: string | null }> = {};
    for (const r of rows) map[r.message_id] = { rating: r.rating, feedback: r.feedback };
    return map;
  }

  // ─── Process Cards ────────────────────────────────────────────────────────

  upsertProcessCard(data: {
    loom_video_id: string;
    loom_url: string;
    title: string;
    summary: string;
    steps: string; // JSON array
    transcript: string | null;
    source_type: string;
    source_id: number;
    content_hash: string;
  }): { action: "created" | "updated" | "unchanged"; card: ProcessCard } {
    const existing = this.db.prepare(
      "SELECT * FROM process_cards WHERE loom_video_id = ? AND title = ?"
    ).get(data.loom_video_id, data.title) as ProcessCard | undefined;

    if (existing) {
      if (existing.content_hash === data.content_hash) {
        return { action: "unchanged", card: existing };
      }
      this.db.prepare(
        `UPDATE process_cards SET summary = ?, steps = ?, transcript = ?, content_hash = ?,
         source_type = ?, source_id = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(data.summary, data.steps, data.transcript, data.content_hash,
        data.source_type, data.source_id, existing.id);
      return { action: "updated", card: this.getProcessCardById(existing.id)! };
    }

    const info = this.db.prepare(
      `INSERT INTO process_cards (loom_video_id, loom_url, title, summary, steps, transcript,
       source_type, source_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(data.loom_video_id, data.loom_url, data.title, data.summary, data.steps,
      data.transcript, data.source_type, data.source_id, data.content_hash);
    return { action: "created", card: this.getProcessCardById(Number(info.lastInsertRowid))! };
  }

  getProcessCardById(id: number): ProcessCard | undefined {
    return this.db.prepare("SELECT * FROM process_cards WHERE id = ?").get(id) as ProcessCard | undefined;
  }

  getProcessCardsByVideoId(videoId: string): ProcessCard[] {
    return this.db.prepare("SELECT * FROM process_cards WHERE loom_video_id = ?").all(videoId) as ProcessCard[];
  }

  getAllProcessCards(limit?: number): ProcessCard[] {
    const sql = limit
      ? `SELECT * FROM process_cards ORDER BY created_at DESC LIMIT ${limit}`
      : "SELECT * FROM process_cards ORDER BY created_at DESC";
    return this.db.prepare(sql).all() as ProcessCard[];
  }

  countProcessCards(): number {
    return (this.db.prepare("SELECT COUNT(*) as n FROM process_cards").get() as { n: number }).n;
  }

  deleteProcessCard(id: number): void {
    this.db.prepare("DELETE FROM term_process_card_map WHERE process_card_id = ?").run(id);
    this.db.prepare("DELETE FROM process_cards WHERE id = ?").run(id);
  }

  searchProcessCards(query: string, limit = 10): Array<ProcessCard & { source_label?: string }> {
    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) {
      return this.db.prepare(
        "SELECT * FROM process_cards ORDER BY created_at DESC LIMIT ?"
      ).all(limit) as ProcessCard[];
    }
    return this.db.prepare(`
      SELECT pc.*, bm25(process_cards_fts, 5.0, 2.0, 1.0) as score
      FROM process_cards_fts fts
      JOIN process_cards pc ON pc.id = fts.rowid
      WHERE process_cards_fts MATCH ?
      ORDER BY score ASC LIMIT ?
    `).all(ftsQuery, limit) as Array<ProcessCard & { source_label?: string }>;
  }

  getHashForVideoId(videoId: string): string | null {
    const row = this.db.prepare(
      "SELECT content_hash FROM process_cards WHERE loom_video_id = ? LIMIT 1"
    ).get(videoId) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  linkTermToProcessCard(termId: number, cardId: number): void {
    this.db.prepare("INSERT OR IGNORE INTO term_process_card_map (term_id, process_card_id) VALUES (?, ?)").run(termId, cardId);
  }

  autoLinkTermsToProcessCard(cardId: number): void {
    const card = this.getProcessCardById(cardId);
    if (!card) return;
    const text = [card.title, card.summary, card.steps].filter(Boolean).join(" ").toLowerCase();
    const terms = this.getAllTerms();
    for (const term of terms) {
      const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]];
      if (names.some((n) => text.includes(n.toLowerCase()))) {
        this.linkTermToProcessCard(term.id, cardId);
      }
    }
  }

  autoLinkTermToAllProcessCards(termId: number): void {
    const term = this.getTermById(termId);
    if (!term) return;
    const names = [term.name, ...JSON.parse(term.aliases || "[]") as string[]].map((n) => n.toLowerCase());
    this.db.prepare("DELETE FROM term_process_card_map WHERE term_id = ?").run(termId);
    const all = this.db.prepare("SELECT id, title, summary, steps FROM process_cards").all() as ProcessCard[];
    for (const card of all) {
      const text = [card.title, card.summary, card.steps].filter(Boolean).join(" ").toLowerCase();
      if (names.some((n) => text.includes(n))) {
        this.linkTermToProcessCard(termId, card.id);
      }
    }
  }

  getTermsForProcessCard(cardId: number): Term[] {
    return this.db.prepare(`
      SELECT t.* FROM terms t
      JOIN term_process_card_map m ON m.term_id = t.id
      WHERE m.process_card_id = ?
    `).all(cardId) as Term[];
  }

  // ─── Tour Completions ─────────────────────────────────────────────────────

  getCompletedTours(userId: number): string[] {
    const rows = this.db.prepare(
      "SELECT tour_key FROM tour_completions WHERE user_id = ?"
    ).all(userId) as Array<{ tour_key: string }>;
    return rows.map((r) => r.tour_key);
  }

  completeTour(userId: number, tourKey: string): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO tour_completions (user_id, tour_key) VALUES (?, ?)"
    ).run(userId, tourKey);
  }

  hasCompletedTour(userId: number, tourKey: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM tour_completions WHERE user_id = ? AND tour_key = ?"
    ).get(userId, tourKey);
    return !!row;
  }

  resetTour(userId: number, tourKey: string): void {
    this.db.prepare(
      "DELETE FROM tour_completions WHERE user_id = ? AND tour_key = ?"
    ).run(userId, tourKey);
  }

  // ─── Widget Installations ─────────────────────────────────────────────────

  createWidgetInstallation(data: {
    key: string;
    name: string;
    allowed_origins: string[];
    calendly_url?: string | null;
    knowledge_base_url?: string | null;
    product_name?: string | null;
    primary_color?: string | null;
    rate_limit_per_hour?: number;
    enable_chat?: boolean;
    enable_email?: boolean;
    enable_calendly?: boolean;
    enable_knowledge_base?: boolean;
  }): WidgetInstallation {
    const info = this.db.prepare(
      `INSERT INTO widget_installations (key, name, allowed_origins, calendly_url, knowledge_base_url, product_name, primary_color, rate_limit_per_hour, enable_chat, enable_email, enable_calendly, enable_knowledge_base)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.key,
      data.name,
      JSON.stringify(data.allowed_origins ?? []),
      data.calendly_url ?? null,
      data.knowledge_base_url ?? null,
      data.product_name ?? null,
      data.primary_color ?? null,
      data.rate_limit_per_hour ?? 60,
      (data.enable_chat ?? true) ? 1 : 0,
      (data.enable_email ?? true) ? 1 : 0,
      (data.enable_calendly ?? true) ? 1 : 0,
      (data.enable_knowledge_base ?? true) ? 1 : 0
    );
    return this.getWidgetInstallationById(Number(info.lastInsertRowid))!;
  }

  updateWidgetInstallation(id: number, fields: Partial<{
    name: string;
    allowed_origins: string[];
    calendly_url: string | null;
    knowledge_base_url: string | null;
    product_name: string | null;
    primary_color: string | null;
    rate_limit_per_hour: number;
    enable_chat: number;
    enable_email: number;
    enable_calendly: number;
    enable_knowledge_base: number;
    is_active: number;
  }>): WidgetInstallation | undefined {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); vals.push(fields.name); }
    if (fields.allowed_origins !== undefined) { sets.push("allowed_origins = ?"); vals.push(JSON.stringify(fields.allowed_origins)); }
    if (fields.calendly_url !== undefined) { sets.push("calendly_url = ?"); vals.push(fields.calendly_url); }
    if (fields.knowledge_base_url !== undefined) { sets.push("knowledge_base_url = ?"); vals.push(fields.knowledge_base_url); }
    if (fields.product_name !== undefined) { sets.push("product_name = ?"); vals.push(fields.product_name); }
    if (fields.primary_color !== undefined) { sets.push("primary_color = ?"); vals.push(fields.primary_color); }
    if (fields.rate_limit_per_hour !== undefined) { sets.push("rate_limit_per_hour = ?"); vals.push(fields.rate_limit_per_hour); }
    if (fields.enable_chat !== undefined) { sets.push("enable_chat = ?"); vals.push(fields.enable_chat); }
    if (fields.enable_email !== undefined) { sets.push("enable_email = ?"); vals.push(fields.enable_email); }
    if (fields.enable_calendly !== undefined) { sets.push("enable_calendly = ?"); vals.push(fields.enable_calendly); }
    if (fields.enable_knowledge_base !== undefined) { sets.push("enable_knowledge_base = ?"); vals.push(fields.enable_knowledge_base); }
    if (fields.is_active !== undefined) { sets.push("is_active = ?"); vals.push(fields.is_active); }
    if (sets.length === 0) return this.getWidgetInstallationById(id);
    sets.push("updated_at = unixepoch()");
    vals.push(id);
    this.db.prepare(`UPDATE widget_installations SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return this.getWidgetInstallationById(id);
  }

  deleteWidgetInstallation(id: number): void {
    this.db.prepare("DELETE FROM widget_installations WHERE id = ?").run(id);
  }

  getWidgetInstallationById(id: number): WidgetInstallation | undefined {
    return this.db.prepare("SELECT * FROM widget_installations WHERE id = ?").get(id) as WidgetInstallation | undefined;
  }

  getWidgetInstallationByKey(key: string): WidgetInstallation | undefined {
    return this.db.prepare("SELECT * FROM widget_installations WHERE key = ?").get(key) as WidgetInstallation | undefined;
  }

  listWidgetInstallations(): Array<WidgetInstallation & { rating_count: number; avg_rating: number | null }> {
    return this.db.prepare(`
      SELECT wi.*,
        (SELECT COUNT(*) FROM widget_ratings WHERE installation_id = wi.id) as rating_count,
        (SELECT AVG(rating) FROM widget_ratings WHERE installation_id = wi.id) as avg_rating
      FROM widget_installations wi
      ORDER BY wi.created_at DESC
    `).all() as Array<WidgetInstallation & { rating_count: number; avg_rating: number | null }>;
  }

  // ─── Widget Ratings ────────────────────────────────────────────────────────

  insertWidgetRating(data: {
    installation_id: number;
    exchange_id: string;
    rating: 1 | 2 | 3;
    feedback: string | null;
    question: string;
    answer: string;
    ip_hash: string;
  }): void {
    this.db.prepare(`
      INSERT INTO widget_ratings (installation_id, exchange_id, rating, feedback, question, answer, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, exchange_id) DO UPDATE SET
        rating = excluded.rating,
        feedback = excluded.feedback
    `).run(data.installation_id, data.exchange_id, data.rating, data.feedback, data.question, data.answer, data.ip_hash);
  }

  getRecentWidgetRatings(installationId: number, limit = 50): WidgetRating[] {
    return this.db.prepare(
      "SELECT * FROM widget_ratings WHERE installation_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(installationId, limit) as WidgetRating[];
  }

  // ─── Widget Rate Limiting (sliding-window, DB-backed) ─────────────────────

  recordWidgetRateEvent(installationId: number, ipHash: string): void {
    this.db.prepare(
      "INSERT INTO widget_rate_events (installation_id, ip_hash) VALUES (?, ?)"
    ).run(installationId, ipHash);
    // Housekeeping: purge events older than 2h for this installation
    this.db.prepare(
      "DELETE FROM widget_rate_events WHERE installation_id = ? AND created_at < unixepoch() - 7200"
    ).run(installationId);
  }

  countWidgetRateEventsLastHour(installationId: number, ipHash: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as n FROM widget_rate_events WHERE installation_id = ? AND ip_hash = ? AND created_at >= unixepoch() - 3600"
    ).get(installationId, ipHash) as { n: number };
    return row.n;
  }

  // ─── Widget Analytics: questions & article clicks ──────────────────────────

  insertWidgetQuestion(data: {
    installation_id: number;
    exchange_id: string;
    question: string;
    answer: string;
    articles: Array<{ id: number; title: string; url: string }>;
    ip_hash: string;
  }): number | null {
    try {
      const info = this.db.prepare(
        `INSERT INTO widget_questions (installation_id, exchange_id, question, question_norm, answer, articles_json, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        data.installation_id,
        data.exchange_id,
        data.question.slice(0, 4000),
        normalizeQuestion(data.question),
        data.answer.slice(0, 8000),
        JSON.stringify(data.articles ?? []),
        data.ip_hash,
      );
      return Number(info.lastInsertRowid);
    } catch {
      // UNIQUE(installation_id, exchange_id) collision — already logged
      const row = this.db.prepare(
        "SELECT id FROM widget_questions WHERE installation_id = ? AND exchange_id = ?"
      ).get(data.installation_id, data.exchange_id) as { id: number } | undefined;
      return row?.id ?? null;
    }
  }

  insertWidgetArticleClick(data: {
    installation_id: number;
    question_id: number | null;
    article_id: number | null;
    article_title: string;
    article_url: string;
    ip_hash: string;
  }): void {
    this.db.prepare(
      `INSERT INTO widget_article_clicks (installation_id, question_id, article_id, article_title, article_url, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      data.installation_id,
      data.question_id,
      data.article_id,
      data.article_title.slice(0, 500),
      data.article_url.slice(0, 1000),
      data.ip_hash,
    );
  }

  getTopWidgetQuestions(installationId: number, sinceTs: number, limit = 10): Array<{
    question_norm: string;
    sample_question: string;
    count: number;
    last_asked_at: number;
  }> {
    return this.db.prepare(`
      SELECT question_norm,
        (SELECT question FROM widget_questions wq2
          WHERE wq2.installation_id = wq.installation_id AND wq2.question_norm = wq.question_norm
          ORDER BY created_at DESC LIMIT 1) as sample_question,
        COUNT(*) as count,
        MAX(created_at) as last_asked_at
      FROM widget_questions wq
      WHERE installation_id = ? AND created_at >= ?
      GROUP BY question_norm
      ORDER BY count DESC, last_asked_at DESC
      LIMIT ?
    `).all(installationId, sinceTs, limit) as Array<{
      question_norm: string;
      sample_question: string;
      count: number;
      last_asked_at: number;
    }>;
  }

  getTopWidgetArticleClicks(installationId: number, sinceTs: number, limit = 10): Array<{
    article_url: string;
    article_title: string;
    clicks: number;
    last_clicked_at: number;
  }> {
    return this.db.prepare(`
      SELECT article_url,
        (SELECT article_title FROM widget_article_clicks c2
          WHERE c2.installation_id = c.installation_id AND c2.article_url = c.article_url
          ORDER BY created_at DESC LIMIT 1) as article_title,
        COUNT(*) as clicks,
        MAX(created_at) as last_clicked_at
      FROM widget_article_clicks c
      WHERE installation_id = ? AND created_at >= ?
      GROUP BY article_url
      ORDER BY clicks DESC, last_clicked_at DESC
      LIMIT ?
    `).all(installationId, sinceTs, limit) as Array<{
      article_url: string;
      article_title: string;
      clicks: number;
      last_clicked_at: number;
    }>;
  }

  getWidgetVolumeByDay(installationId: number, days: number): Array<{
    day: string;
    questions: number;
    ratings: number;
    clicks: number;
  }> {
    const sinceTs = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = this.db.prepare(`
      WITH days AS (
        SELECT date('now', '-' || x.n || ' days') as day
        FROM (
          WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n < ?)
          SELECT n FROM seq
        ) x
      )
      SELECT d.day,
        (SELECT COUNT(*) FROM widget_questions WHERE installation_id = ? AND created_at >= ?
          AND date(created_at, 'unixepoch') = d.day) as questions,
        (SELECT COUNT(*) FROM widget_ratings WHERE installation_id = ? AND created_at >= ?
          AND date(created_at, 'unixepoch') = d.day) as ratings,
        (SELECT COUNT(*) FROM widget_article_clicks WHERE installation_id = ? AND created_at >= ?
          AND date(created_at, 'unixepoch') = d.day) as clicks
      FROM days d
      ORDER BY d.day ASC
    `).all(days - 1, installationId, sinceTs, installationId, sinceTs, installationId, sinceTs) as Array<{
      day: string;
      questions: number;
      ratings: number;
      clicks: number;
    }>;
    return rows;
  }

  getWidgetRatingBreakdown(installationId: number, sinceTs: number): {
    total: number;
    avg: number | null;
    by_rating: { 1: number; 2: number; 3: number };
  } {
    const rows = this.db.prepare(`
      SELECT rating, COUNT(*) as n FROM widget_ratings
      WHERE installation_id = ? AND created_at >= ?
      GROUP BY rating
    `).all(installationId, sinceTs) as Array<{ rating: 1 | 2 | 3; n: number }>;
    const by: { 1: number; 2: number; 3: number } = { 1: 0, 2: 0, 3: 0 };
    let total = 0;
    let weighted = 0;
    for (const r of rows) {
      by[r.rating] = r.n;
      total += r.n;
      weighted += r.rating * r.n;
    }
    return { total, avg: total > 0 ? weighted / total : null, by_rating: by };
  }

  getWidgetRatingsFeed(installationId: number, sinceTs: number, opts: {
    ratingFilter?: 1 | 2 | 3 | null;
    limit?: number;
  } = {}): WidgetRating[] {
    const limit = opts.limit ?? 50;
    if (opts.ratingFilter) {
      return this.db.prepare(
        `SELECT * FROM widget_ratings
         WHERE installation_id = ? AND created_at >= ? AND rating = ?
         ORDER BY created_at DESC LIMIT ?`
      ).all(installationId, sinceTs, opts.ratingFilter, limit) as WidgetRating[];
    }
    return this.db.prepare(
      `SELECT * FROM widget_ratings
       WHERE installation_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(installationId, sinceTs, limit) as WidgetRating[];
  }

  getWidgetQuestionRow(installationId: number, exchangeId: string): WidgetQuestion | undefined {
    return this.db.prepare(
      "SELECT * FROM widget_questions WHERE installation_id = ? AND exchange_id = ?"
    ).get(installationId, exchangeId) as WidgetQuestion | undefined;
  }

  listWidgetArticleClicksForQuestion(questionId: number): WidgetArticleClick[] {
    return this.db.prepare(
      "SELECT * FROM widget_article_clicks WHERE question_id = ? ORDER BY created_at DESC"
    ).all(questionId) as WidgetArticleClick[];
  }

  // ─── Insights / Dashboard ─────────────────────────────────────────────────

  getQAPairsMissingRootCause(): QAPair[] {
    return this.db
      .prepare("SELECT * FROM qa_pairs WHERE root_cause IS NULL ORDER BY created_at DESC")
      .all() as QAPair[];
  }

  /** Stats inside (sinceTs..now] plus the same-length prior window for delta arrows. */
  getInsightStats(sinceTs: number | null): {
    tickets: number;
    qa_pairs: number;
    resolved_pct: number;
    prev_tickets: number;
    recurring_share_pct: number;
    at_risk_count: number;
  } {
    const ticketsRow = sinceTs === null
      ? this.db.prepare("SELECT COUNT(*) as n FROM tickets").get() as { n: number }
      : this.db.prepare("SELECT COUNT(*) as n FROM tickets WHERE COALESCE(hubspot_created_at, created_at) >= ?").get(sinceTs) as { n: number };

    const qaRow = sinceTs === null
      ? this.db.prepare("SELECT COUNT(*) as n, SUM(resolved) as r FROM qa_pairs").get() as { n: number; r: number | null }
      : this.db.prepare(
          `SELECT COUNT(*) as n, SUM(qa.resolved) as r FROM qa_pairs qa
           JOIN tickets t ON qa.ticket_id = t.id
           WHERE COALESCE(t.hubspot_created_at, t.created_at) >= ?`
        ).get(sinceTs) as { n: number; r: number | null };

    let prevTickets = 0;
    if (sinceTs !== null) {
      const windowSize = Math.floor(Date.now() / 1000) - sinceTs;
      const prevStart = sinceTs - windowSize;
      const prevRow = this.db
        .prepare(
          "SELECT COUNT(*) as n FROM tickets WHERE COALESCE(hubspot_created_at, created_at) >= ? AND COALESCE(hubspot_created_at, created_at) < ?"
        )
        .get(prevStart, sinceTs) as { n: number };
      prevTickets = prevRow.n;
    }

    // Recurring share = qa_pairs whose category has >=3 qa_pairs in window / total qa
    const recurringRow = sinceTs === null
      ? this.db.prepare(
          `SELECT COUNT(*) as n FROM qa_pairs qa
           JOIN qa_category_map m ON m.qa_id = qa.id
           WHERE m.category_id IN (
             SELECT m2.category_id FROM qa_category_map m2
             GROUP BY m2.category_id HAVING COUNT(*) >= 3
           )`
        ).get() as { n: number }
      : this.db.prepare(
          `SELECT COUNT(DISTINCT qa.id) as n FROM qa_pairs qa
           JOIN tickets t ON qa.ticket_id = t.id
           JOIN qa_category_map m ON m.qa_id = qa.id
           WHERE COALESCE(t.hubspot_created_at, t.created_at) >= ?
             AND m.category_id IN (
               SELECT m2.category_id FROM qa_category_map m2
               JOIN qa_pairs qa2 ON qa2.id = m2.qa_id
               JOIN tickets t2 ON qa2.ticket_id = t2.id
               WHERE COALESCE(t2.hubspot_created_at, t2.created_at) >= ?
               GROUP BY m2.category_id HAVING COUNT(*) >= 3
             )`
        ).get(sinceTs, sinceTs) as { n: number };

    const atRisk = this.getAtRiskCustomers(sinceTs).filter((c) => c.suggest_onboarding).length;

    return {
      tickets: ticketsRow.n,
      qa_pairs: qaRow.n,
      resolved_pct: qaRow.n > 0 ? Math.round(((qaRow.r ?? 0) / qaRow.n) * 100) : 0,
      prev_tickets: prevTickets,
      recurring_share_pct: qaRow.n > 0 ? Math.round((recurringRow.n / qaRow.n) * 100) : 0,
      at_risk_count: atRisk,
    };
  }

  /** Recurring issues, grouped by category (the categorizer already does the
   *  semantic clustering — question_template is too specific to repeat). */
  getRecurringIssues(sinceTs: number | null, minCount = 3, limit = 20): Array<{
    template: string;          // category name (kept name for API compatibility)
    count: number;
    last_seen: number;
    sample_question: string;
    category_name: string | null;
    root_cause: string | null;
  }> {
    const where = sinceTs === null
      ? "1=1"
      : "COALESCE(t.hubspot_created_at, t.created_at) >= ?";
    const params: unknown[] = sinceTs === null ? [] : [sinceTs];

    const rows = this.db.prepare(
      `SELECT c.id as category_id,
              c.name as category_name,
              COUNT(qa.id) as count,
              MAX(qa.created_at) as last_seen,
              MAX(qa.question) as sample_question,
              (
                SELECT qa2.root_cause FROM qa_pairs qa2
                JOIN qa_category_map m2 ON m2.qa_id = qa2.id
                WHERE m2.category_id = c.id AND qa2.root_cause IS NOT NULL
                GROUP BY qa2.root_cause
                ORDER BY COUNT(*) DESC
                LIMIT 1
              ) as root_cause
       FROM categories c
       JOIN qa_category_map m ON m.category_id = c.id
       JOIN qa_pairs qa ON qa.id = m.qa_id
       JOIN tickets t ON t.id = qa.ticket_id
       WHERE ${where}
       GROUP BY c.id
       HAVING COUNT(qa.id) >= ?
       ORDER BY count DESC, last_seen DESC
       LIMIT ?`
    ).all(...params, minCount, limit) as Array<{
      category_id: number;
      category_name: string;
      count: number;
      last_seen: number;
      sample_question: string;
      root_cause: string | null;
    }>;

    return rows.map((r) => ({
      template: r.category_name,
      count: r.count,
      last_seen: r.last_seen,
      sample_question: r.sample_question,
      category_name: r.category_name,
      root_cause: r.root_cause,
    }));
  }

  getRootCauseBreakdown(sinceTs: number | null): Array<{ root_cause: string; count: number }> {
    const sql = sinceTs === null
      ? `SELECT COALESCE(qa.root_cause, 'other') as root_cause, COUNT(*) as count
         FROM qa_pairs qa
         GROUP BY COALESCE(qa.root_cause, 'other')
         ORDER BY count DESC`
      : `SELECT COALESCE(qa.root_cause, 'other') as root_cause, COUNT(*) as count
         FROM qa_pairs qa
         JOIN tickets t ON qa.ticket_id = t.id
         WHERE COALESCE(t.hubspot_created_at, t.created_at) >= ?
         GROUP BY COALESCE(qa.root_cause, 'other')
         ORDER BY count DESC`;
    const rows = sinceTs === null
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all(sinceTs);
    return rows as Array<{ root_cause: string; count: number }>;
  }

  /** Stacked weekly trend. bucketDays is the bucket width (default 7). */
  getRootCauseTrend(sinceTs: number | null, bucketDays = 7): Array<{
    date_bucket: string;
    root_cause: string;
    count: number;
  }> {
    const bucketSecs = bucketDays * 86400;
    const sql = sinceTs === null
      ? `SELECT strftime('%Y-%m-%d', datetime((COALESCE(t.hubspot_created_at, t.created_at) / ${bucketSecs}) * ${bucketSecs}, 'unixepoch')) as date_bucket,
                COALESCE(qa.root_cause, 'other') as root_cause,
                COUNT(*) as count
         FROM qa_pairs qa
         JOIN tickets t ON qa.ticket_id = t.id
         GROUP BY date_bucket, root_cause
         ORDER BY date_bucket ASC`
      : `SELECT strftime('%Y-%m-%d', datetime((COALESCE(t.hubspot_created_at, t.created_at) / ${bucketSecs}) * ${bucketSecs}, 'unixepoch')) as date_bucket,
                COALESCE(qa.root_cause, 'other') as root_cause,
                COUNT(*) as count
         FROM qa_pairs qa
         JOIN tickets t ON qa.ticket_id = t.id
         WHERE COALESCE(t.hubspot_created_at, t.created_at) >= ?
         GROUP BY date_bucket, root_cause
         ORDER BY date_bucket ASC`;
    const rows = sinceTs === null
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all(sinceTs);
    return rows as Array<{ date_bucket: string; root_cause: string; count: number }>;
  }

  getAtRiskCustomers(sinceTs: number | null, limit = 20): Array<{
    company_name: string;
    contact_emails: string[];
    ticket_count: number;
    how_to_pct: number;
    onboarding_gap_pct: number;
    last_ticket_at: number;
    suggest_onboarding: boolean;
  }> {
    const where = sinceTs === null
      ? "t.company_name IS NOT NULL AND t.company_name != ''"
      : "t.company_name IS NOT NULL AND t.company_name != '' AND COALESCE(t.hubspot_created_at, t.created_at) >= ?";
    const params: unknown[] = sinceTs === null ? [] : [sinceTs];

    const rows = this.db.prepare(
      `SELECT t.company_name as company_name,
              COUNT(DISTINCT t.id) as ticket_count,
              MAX(COALESCE(t.hubspot_created_at, t.created_at)) as last_ticket_at,
              GROUP_CONCAT(DISTINCT t.contact_email) as emails_csv,
              SUM(CASE WHEN qa.root_cause = 'how_to' THEN 1 ELSE 0 END) as how_to_count,
              SUM(CASE WHEN qa.root_cause = 'onboarding_gap' THEN 1 ELSE 0 END) as onboarding_gap_count,
              COUNT(qa.id) as qa_count
       FROM tickets t
       LEFT JOIN qa_pairs qa ON qa.ticket_id = t.id
       WHERE ${where}
       GROUP BY t.company_name
       ORDER BY ticket_count DESC, last_ticket_at DESC
       LIMIT ?`
    ).all(...params, limit) as Array<{
      company_name: string;
      ticket_count: number;
      last_ticket_at: number;
      emails_csv: string | null;
      how_to_count: number;
      onboarding_gap_count: number;
      qa_count: number;
    }>;

    return rows.map((r) => {
      const emails = (r.emails_csv ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      const howToPct = r.qa_count > 0 ? (r.how_to_count / r.qa_count) * 100 : 0;
      const onboardingPct = r.qa_count > 0 ? (r.onboarding_gap_count / r.qa_count) * 100 : 0;
      const fraction = r.qa_count > 0 ? (r.how_to_count + r.onboarding_gap_count) / r.qa_count : 0;
      return {
        company_name: r.company_name,
        contact_emails: emails,
        ticket_count: r.ticket_count,
        how_to_pct: Math.round(howToPct),
        onboarding_gap_pct: Math.round(onboardingPct),
        last_ticket_at: r.last_ticket_at,
        suggest_onboarding: r.ticket_count >= 5 && fraction >= 0.6,
      };
    });
  }

  getCustomerTickets(companyName: string, sinceTs: number | null): {
    tickets: Array<Ticket & { qa_root_causes: string[] }>;
    root_cause_distribution: Array<{ root_cause: string; count: number }>;
    contacts: Array<{ contact_email: string | null; contact_name: string | null }>;
  } {
    const where = sinceTs === null
      ? "t.company_name = ?"
      : "t.company_name = ? AND COALESCE(t.hubspot_created_at, t.created_at) >= ?";
    const params: unknown[] = sinceTs === null ? [companyName] : [companyName, sinceTs];

    const tickets = this.db.prepare(
      `SELECT t.* FROM tickets t WHERE ${where} ORDER BY COALESCE(t.hubspot_created_at, t.created_at) DESC`
    ).all(...params) as Ticket[];

    const ticketsWithCauses = tickets.map((t) => {
      const causes = this.db.prepare(
        "SELECT COALESCE(root_cause, 'other') as rc FROM qa_pairs WHERE ticket_id = ?"
      ).all(t.id) as Array<{ rc: string }>;
      return { ...t, qa_root_causes: causes.map((c) => c.rc) };
    });

    const distribution = this.db.prepare(
      `SELECT COALESCE(qa.root_cause, 'other') as root_cause, COUNT(*) as count
       FROM qa_pairs qa
       JOIN tickets t ON qa.ticket_id = t.id
       WHERE ${where}
       GROUP BY COALESCE(qa.root_cause, 'other')
       ORDER BY count DESC`
    ).all(...params) as Array<{ root_cause: string; count: number }>;

    const contacts = this.db.prepare(
      `SELECT DISTINCT t.contact_email, t.contact_name FROM tickets t WHERE ${where}
       AND t.contact_email IS NOT NULL`
    ).all(...params) as Array<{ contact_email: string | null; contact_name: string | null }>;

    return { tickets: ticketsWithCauses, root_cause_distribution: distribution, contacts };
  }

  // ─── Microsoft Clarity metrics ────────────────────────────────────────────

  upsertClarityMetric(data: Omit<ClarityMetric, "id" | "fetched_at">): void {
    this.db.prepare(
      `INSERT INTO clarity_metrics
       (fetched_at, date_bucket, dimension, dimension_value, traffic,
        rage_click_sessions, dead_click_sessions, excessive_scroll_sessions,
        quick_back_sessions, js_error_sessions)
       VALUES (unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date_bucket, dimension, dimension_value) DO UPDATE SET
         fetched_at = unixepoch(),
         traffic = excluded.traffic,
         rage_click_sessions = excluded.rage_click_sessions,
         dead_click_sessions = excluded.dead_click_sessions,
         excessive_scroll_sessions = excluded.excessive_scroll_sessions,
         quick_back_sessions = excluded.quick_back_sessions,
         js_error_sessions = excluded.js_error_sessions`
    ).run(
      data.date_bucket,
      data.dimension,
      data.dimension_value,
      data.traffic,
      data.rage_click_sessions,
      data.dead_click_sessions,
      data.excessive_scroll_sessions,
      data.quick_back_sessions,
      data.js_error_sessions
    );
  }

  getClarityHotspots(sinceTs: number | null, limit = 10): Array<{
    page: string;
    traffic: number;
    rage_clicks: number;
    dead_clicks: number;
    js_errors: number;
    quick_back: number;
    friction_total: number;
  }> {
    // Prefer Page dimension if it has data, else fall back to URL.
    // Some Clarity projects only return URL-level data depending on how pages
    // are configured / instrumented.
    const dateClause = sinceTs === null ? "" : "AND date_bucket >= date(?, 'unixepoch')";
    const params: unknown[] = sinceTs === null ? [] : [sinceTs];

    const pageCount = sinceTs === null
      ? this.db.prepare("SELECT COUNT(*) as n FROM clarity_metrics WHERE dimension = 'Page'").get() as { n: number }
      : this.db.prepare("SELECT COUNT(*) as n FROM clarity_metrics WHERE dimension = 'Page' AND date_bucket >= date(?, 'unixepoch')").get(sinceTs) as { n: number };

    const dimension = pageCount.n > 0 ? "Page" : "URL";

    const rows = this.db.prepare(
      `SELECT dimension_value as page,
              SUM(traffic) as traffic,
              SUM(rage_click_sessions) as rage_clicks,
              SUM(dead_click_sessions) as dead_clicks,
              SUM(js_error_sessions) as js_errors,
              SUM(quick_back_sessions) as quick_back,
              SUM(rage_click_sessions + dead_click_sessions + js_error_sessions + quick_back_sessions) as friction_total
       FROM clarity_metrics
       WHERE dimension = '${dimension}' ${dateClause}
       GROUP BY dimension_value
       HAVING friction_total > 0
       ORDER BY friction_total DESC
       LIMIT ?`
    ).all(...params, limit) as Array<{
      page: string;
      traffic: number;
      rage_clicks: number;
      dead_clicks: number;
      js_errors: number;
      quick_back: number;
      friction_total: number;
    }>;
    return rows;
  }

  countClarityRows(): number {
    const r = this.db.prepare("SELECT COUNT(*) as n FROM clarity_metrics").get() as { n: number };
    return r.n;
  }

  clearClarityMetricsForDate(dateBucket: string, dimensions: string[]): void {
    if (dimensions.length === 0) return;
    const placeholders = dimensions.map(() => "?").join(", ");
    this.db.prepare(
      `DELETE FROM clarity_metrics WHERE date_bucket = ? AND dimension IN (${placeholders})`
    ).run(dateBucket, ...dimensions);
  }

  // ─── Issue Cards (Phase 2 synthesis layer) ────────────────────────────────

  /** Enriched per-category aggregation: count, prev-window count, resolved %,
   *  distinct companies, top-3 companies, 3 sample questions, modal root cause. */
  getRecurringIssuesEnriched(sinceTs: number | null, minCount = 3, limit = 20): Array<{
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
  }> {
    const where = sinceTs === null ? "1=1" : "COALESCE(t.hubspot_created_at, t.created_at) >= ?";
    const params: unknown[] = sinceTs === null ? [] : [sinceTs];

    const baseRows = this.db.prepare(
      `SELECT c.id as category_id,
              c.name as category_name,
              COUNT(qa.id) as count,
              MAX(qa.created_at) as last_seen,
              SUM(qa.resolved) as resolved_count,
              COUNT(DISTINCT t.company_name) as distinct_companies,
              (
                SELECT qa2.root_cause FROM qa_pairs qa2
                JOIN qa_category_map m2 ON m2.qa_id = qa2.id
                WHERE m2.category_id = c.id AND qa2.root_cause IS NOT NULL
                GROUP BY qa2.root_cause
                ORDER BY COUNT(*) DESC LIMIT 1
              ) as top_root_cause
       FROM categories c
       JOIN qa_category_map m ON m.category_id = c.id
       JOIN qa_pairs qa ON qa.id = m.qa_id
       JOIN tickets t ON t.id = qa.ticket_id
       WHERE ${where}
       GROUP BY c.id
       HAVING COUNT(qa.id) >= ?
       ORDER BY count DESC, last_seen DESC
       LIMIT ?`
    ).all(...params, minCount, limit) as Array<{
      category_id: number;
      category_name: string;
      count: number;
      last_seen: number;
      resolved_count: number | null;
      distinct_companies: number;
      top_root_cause: string | null;
    }>;

    if (baseRows.length === 0) return [];

    // Compute prev_count per category (equal-length prior window) — skip when range = "all"
    let prevCountByCat = new Map<number, number>();
    if (sinceTs !== null) {
      const windowSize = Math.floor(Date.now() / 1000) - sinceTs;
      const prevStart = sinceTs - windowSize;
      const ids = baseRows.map((r) => r.category_id);
      const placeholders = ids.map(() => "?").join(", ");
      const prevRows = this.db.prepare(
        `SELECT c.id as category_id, COUNT(qa.id) as prev_count
         FROM categories c
         JOIN qa_category_map m ON m.category_id = c.id
         JOIN qa_pairs qa ON qa.id = m.qa_id
         JOIN tickets t ON t.id = qa.ticket_id
         WHERE c.id IN (${placeholders})
           AND COALESCE(t.hubspot_created_at, t.created_at) >= ?
           AND COALESCE(t.hubspot_created_at, t.created_at) < ?
         GROUP BY c.id`
      ).all(...ids, prevStart, sinceTs) as Array<{ category_id: number; prev_count: number }>;
      prevCountByCat = new Map(prevRows.map((r) => [r.category_id, r.prev_count]));
    }

    // Per-category: top 3 companies + 3 sample questions
    const topCompaniesStmt = this.db.prepare(
      `SELECT t.company_name, COUNT(DISTINCT t.id) as ticket_count
       FROM qa_pairs qa
       JOIN qa_category_map m ON m.qa_id = qa.id
       JOIN tickets t ON t.id = qa.ticket_id
       WHERE m.category_id = ?
         AND t.company_name IS NOT NULL AND t.company_name != ''
         ${sinceTs === null ? "" : "AND COALESCE(t.hubspot_created_at, t.created_at) >= ?"}
       GROUP BY t.company_name
       ORDER BY ticket_count DESC, MAX(COALESCE(t.hubspot_created_at, t.created_at)) DESC
       LIMIT 3`
    );

    const sampleQuestionsStmt = this.db.prepare(
      `SELECT DISTINCT qa.question
       FROM qa_pairs qa
       JOIN qa_category_map m ON m.qa_id = qa.id
       JOIN tickets t ON t.id = qa.ticket_id
       WHERE m.category_id = ?
         ${sinceTs === null ? "" : "AND COALESCE(t.hubspot_created_at, t.created_at) >= ?"}
       ORDER BY qa.created_at DESC
       LIMIT 3`
    );

    return baseRows.map((r) => {
      const topCompaniesParams: unknown[] = sinceTs === null ? [r.category_id] : [r.category_id, sinceTs];
      const top_companies = topCompaniesStmt.all(...topCompaniesParams) as Array<{ company_name: string; ticket_count: number }>;

      const sampleParams: unknown[] = sinceTs === null ? [r.category_id] : [r.category_id, sinceTs];
      const sampleRows = sampleQuestionsStmt.all(...sampleParams) as Array<{ question: string }>;

      return {
        category_id: r.category_id,
        category_name: r.category_name,
        count: r.count,
        prev_count: prevCountByCat.get(r.category_id) ?? 0,
        last_seen: r.last_seen,
        top_root_cause: r.top_root_cause,
        resolved_pct: r.count > 0 ? Math.round(((r.resolved_count ?? 0) / r.count) * 100) : 0,
        distinct_companies: r.distinct_companies,
        top_companies,
        sample_questions: sampleRows.map((s) => s.question),
      };
    });
  }

  /** Return concatenated qa_pair text per category for entity extraction.
   *  Combines question + answer + summary so entity extraction sees all mentions. */
  getCategoryQATexts(categoryIds: number[], sinceTs: number | null): Map<number, string[]> {
    if (categoryIds.length === 0) return new Map();
    const placeholders = categoryIds.map(() => "?").join(", ");
    const where = sinceTs === null
      ? `m.category_id IN (${placeholders})`
      : `m.category_id IN (${placeholders}) AND COALESCE(t.hubspot_created_at, t.created_at) >= ?`;
    const params: unknown[] = sinceTs === null ? [...categoryIds] : [...categoryIds, sinceTs];

    const rows = this.db.prepare(
      `SELECT m.category_id, qa.question, qa.answer, qa.summary
       FROM qa_pairs qa
       JOIN qa_category_map m ON m.qa_id = qa.id
       JOIN tickets t ON t.id = qa.ticket_id
       WHERE ${where}`
    ).all(...params) as Array<{ category_id: number; question: string; answer: string | null; summary: string | null }>;

    const out = new Map<number, string[]>();
    for (const r of rows) {
      const text = [r.question, r.answer ?? "", r.summary ?? ""].filter(Boolean).join(" ");
      const list = out.get(r.category_id) ?? [];
      list.push(text);
      out.set(r.category_id, list);
    }
    return out;
  }

  // ─── Insight cache (for AI executive summary) ─────────────────────────────

  getInsightCache(dateKey: string, contentHash: string): string | null {
    const row = this.db.prepare(
      "SELECT payload FROM insight_cache WHERE date_key = ? AND content_hash = ?"
    ).get(dateKey, contentHash) as { payload: string } | undefined;
    return row?.payload ?? null;
  }

  setInsightCache(dateKey: string, contentHash: string, payload: string): void {
    this.db.prepare(
      `INSERT INTO insight_cache (date_key, content_hash, payload) VALUES (?, ?, ?)
       ON CONFLICT(date_key, content_hash) DO UPDATE SET payload = excluded.payload, created_at = unixepoch()`
    ).run(dateKey, contentHash, payload);
  }

  // ─── Widget Events (analytics) ──────────────────────────────────────────────

  recordWidgetEvent(data: {
    installation_id: number;
    event_type: WidgetEventType;
    source_url: string | null;
    ip_hash: string;
    metadata?: Record<string, unknown> | null;
  }): void {
    this.db.prepare(
      "INSERT INTO widget_events (installation_id, event_type, source_url, ip_hash, metadata) VALUES (?, ?, ?, ?, ?)"
    ).run(
      data.installation_id,
      data.event_type,
      data.source_url,
      data.ip_hash,
      data.metadata ? JSON.stringify(data.metadata) : null
    );
  }

  /** Aggregate analytics for an installation over the last `days` days. */
  getInstallationAnalytics(installationId: number, days: number): {
    totals: Record<string, number>;
    uniques: Record<string, number>;
    daily: Array<{ date: string; counts: Record<string, number> }>;
    topSourceUrls: Array<{ url: string; count: number }>;
  } {
    const sinceSeconds = days * 86400;

    const totalsRows = this.db.prepare(
      `SELECT event_type, COUNT(*) as c, COUNT(DISTINCT ip_hash) as u
       FROM widget_events
       WHERE installation_id = ? AND created_at >= unixepoch() - ?
       GROUP BY event_type`
    ).all(installationId, sinceSeconds) as Array<{ event_type: string; c: number; u: number }>;

    const totals: Record<string, number> = {};
    const uniques: Record<string, number> = {};
    for (const r of totalsRows) {
      totals[r.event_type] = r.c;
      uniques[r.event_type] = r.u;
    }

    const dailyRows = this.db.prepare(
      `SELECT date(created_at, 'unixepoch') as d, event_type, COUNT(*) as c
       FROM widget_events
       WHERE installation_id = ? AND created_at >= unixepoch() - ?
       GROUP BY d, event_type
       ORDER BY d ASC`
    ).all(installationId, sinceSeconds) as Array<{ d: string; event_type: string; c: number }>;

    const dailyMap = new Map<string, Record<string, number>>();
    for (const r of dailyRows) {
      const bucket = dailyMap.get(r.d) ?? {};
      bucket[r.event_type] = r.c;
      dailyMap.set(r.d, bucket);
    }
    const daily = Array.from(dailyMap.entries()).map(([date, counts]) => ({ date, counts }));

    const topSourceUrls = this.db.prepare(
      `SELECT source_url as url, COUNT(*) as count
       FROM widget_events
       WHERE installation_id = ? AND created_at >= unixepoch() - ? AND source_url IS NOT NULL AND source_url != ''
       GROUP BY source_url
       ORDER BY count DESC
       LIMIT 5`
    ).all(installationId, sinceSeconds) as Array<{ url: string; count: number }>;

    return { totals, uniques, daily, topSourceUrls };
  }
}
