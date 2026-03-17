import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Types

export interface Ticket {
  id: number;
  hubspot_id: string;
  subject: string | null;
  content: string | null;
  conversation_text: string | null;
  channel: string | null;
  status: string | null;
  priority: string | null;
  hubspot_created_at: number | null;
  hubspot_updated_at: number | null;
  processed_at: number | null;
  created_at: number;
}

export interface QAPair {
  id: number;
  ticket_id: number;
  question: string;
  question_template: string | null;
  question_variables: string | null; // JSON string: [{name, value}]
  answer: string | null;
  resolution_steps: string | null; // JSON string: string[]
  summary: string | null;
  resolved: number; // 0 | 1
  channel: string | null;
  created_at: number;
  updated_at: number | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  qa_count: number;
  created_at: number;
  updated_at: number;
}

export interface QACategoryMap {
  qa_id: number;
  category_id: number;
  confidence: number;
}

export interface SyncState {
  id: number;
  last_sync_at: number | null;
  last_run_at: number | null;
  tickets_synced_total: number;
  qa_pairs_total: number;
  new_qa_since_recluster: number;
}

export interface Term {
  id: number;
  name: string;
  definition: string;
  aliases: string; // JSON array of strings
  created_at: number;
  updated_at: number;
}

export interface KBArticle {
  id: number;
  url: string;
  title: string;
  content: string;
  category: string | null;
  scraped_at: number;
  content_hash: string;
}

export interface CorrectionLog {
  id: number;
  qa_id: number;
  agent_question: string;
  agent_answer: string;
  user_feedback: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: number;
}

export interface BehavioralCard {
  id: number;
  title: string;
  instruction: string;
  type: "knowledge" | "solution" | "general";
  scope: "global" | "category";
  category_id: number | null;
  active: number; // 0 | 1
  source: string; // "manual" | "suggested"
  correction_log_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface RefDoc {
  id: number;
  title: string;
  source_type: "google_doc" | "manual";
  source_url: string | null;
  active: number; // 0 | 1
  created_at: number;
  updated_at: number;
}

export interface RefDocSection {
  id: number;
  doc_id: number;
  heading: string;
  content: string;
  section_order: number;
  content_hash: string;
  created_at: number;
  updated_at: number;
}

// Singleton DB connection

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

function initDb(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hubspot_id TEXT UNIQUE NOT NULL,
      subject TEXT,
      content TEXT,
      conversation_text TEXT,
      channel TEXT,
      status TEXT,
      priority TEXT,
      hubspot_created_at INTEGER,
      hubspot_updated_at INTEGER,
      processed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS qa_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      question TEXT NOT NULL,
      question_template TEXT,
      question_variables TEXT,
      answer TEXT,
      resolution_steps TEXT,
      summary TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      channel TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      qa_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS qa_category_map (
      qa_id INTEGER NOT NULL REFERENCES qa_pairs(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      confidence REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (qa_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      last_sync_at INTEGER,
      last_run_at INTEGER,
      tickets_synced_total INTEGER NOT NULL DEFAULT 0,
      qa_pairs_total INTEGER NOT NULL DEFAULT 0,
      new_qa_since_recluster INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_hubspot_id ON tickets(hubspot_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_processed ON tickets(processed_at);
    CREATE INDEX IF NOT EXISTS idx_qa_ticket ON qa_pairs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_qa_category_map_qa ON qa_category_map(qa_id);
    CREATE INDEX IF NOT EXISTS idx_qa_category_map_cat ON qa_category_map(category_id);

    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      definition TEXT NOT NULL,
      aliases TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS term_qa_map (
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      qa_id INTEGER NOT NULL REFERENCES qa_pairs(id) ON DELETE CASCADE,
      PRIMARY KEY (term_id, qa_id)
    );

    CREATE TABLE IF NOT EXISTS kb_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      scraped_at INTEGER NOT NULL DEFAULT (unixepoch()),
      content_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS term_article_map (
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      PRIMARY KEY (term_id, article_id)
    );

    CREATE INDEX IF NOT EXISTS idx_term_qa_map_term ON term_qa_map(term_id);
    CREATE INDEX IF NOT EXISTS idx_term_qa_map_qa ON term_qa_map(qa_id);
    CREATE INDEX IF NOT EXISTS idx_term_article_map_term ON term_article_map(term_id);
    CREATE INDEX IF NOT EXISTS idx_term_article_map_article ON term_article_map(article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category);

    CREATE TABLE IF NOT EXISTS correction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qa_id INTEGER NOT NULL REFERENCES qa_pairs(id) ON DELETE CASCADE,
      agent_question TEXT NOT NULL,
      agent_answer TEXT NOT NULL,
      user_feedback TEXT NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_correction_logs_qa ON correction_logs(qa_id);

    CREATE TABLE IF NOT EXISTS behavioral_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      instruction TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general' CHECK(type IN ('knowledge', 'solution', 'general')),
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'category')),
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT DEFAULT 'manual',
      correction_log_id INTEGER REFERENCES correction_logs(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_behavioral_cards_active ON behavioral_cards(active);

    CREATE TABLE IF NOT EXISTS ref_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('google_doc', 'manual')),
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ref_docs_active ON ref_docs(active);

    CREATE TABLE IF NOT EXISTS ref_doc_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL REFERENCES ref_docs(id) ON DELETE CASCADE,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      section_order INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ref_doc_sections_doc ON ref_doc_sections(doc_id);
  `);

  // Migrations: add columns if they don't exist yet
  const migrations = [
    "ALTER TABLE qa_pairs ADD COLUMN resolution_steps TEXT",
    "ALTER TABLE qa_pairs ADD COLUMN updated_at INTEGER",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // --- FTS5 full-text search indexes ---
  // Non-external tables (store own copy) for reliable MATCH queries
  // porter unicode61 tokenizer gives proper English stemming + unicode support
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS qa_pairs_fts USING fts5(
        question, answer, summary, question_template,
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(
        title, content,
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS ref_doc_sections_fts USING fts5(
        heading, content,
        tokenize='porter unicode61'
      );
    `);
  } catch { /* FTS tables already exist */ }

  // Sync triggers: keep FTS indexes in sync with source tables
  const triggerSql = `
    -- qa_pairs triggers
    CREATE TRIGGER IF NOT EXISTS qa_pairs_fts_ai AFTER INSERT ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(rowid, question, answer, summary, question_template)
      VALUES (new.id, new.question, new.answer, new.summary, new.question_template);
    END;
    CREATE TRIGGER IF NOT EXISTS qa_pairs_fts_ad AFTER DELETE ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question, answer, summary, question_template)
      VALUES ('delete', old.id, old.question, old.answer, old.summary, old.question_template);
    END;
    CREATE TRIGGER IF NOT EXISTS qa_pairs_fts_au AFTER UPDATE ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question, answer, summary, question_template)
      VALUES ('delete', old.id, old.question, old.answer, old.summary, old.question_template);
      INSERT INTO qa_pairs_fts(rowid, question, answer, summary, question_template)
      VALUES (new.id, new.question, new.answer, new.summary, new.question_template);
    END;

    -- kb_articles triggers
    CREATE TRIGGER IF NOT EXISTS kb_articles_fts_ai AFTER INSERT ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(rowid, title, content)
      VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_articles_fts_ad AFTER DELETE ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
      VALUES ('delete', old.id, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_articles_fts_au AFTER UPDATE ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
      VALUES ('delete', old.id, old.title, old.content);
      INSERT INTO kb_articles_fts(rowid, title, content)
      VALUES (new.id, new.title, new.content);
    END;

    -- ref_doc_sections triggers
    CREATE TRIGGER IF NOT EXISTS ref_doc_sections_fts_ai AFTER INSERT ON ref_doc_sections BEGIN
      INSERT INTO ref_doc_sections_fts(rowid, heading, content)
      VALUES (new.id, new.heading, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS ref_doc_sections_fts_ad AFTER DELETE ON ref_doc_sections BEGIN
      INSERT INTO ref_doc_sections_fts(ref_doc_sections_fts, rowid, heading, content)
      VALUES ('delete', old.id, old.heading, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS ref_doc_sections_fts_au AFTER UPDATE ON ref_doc_sections BEGIN
      INSERT INTO ref_doc_sections_fts(ref_doc_sections_fts, rowid, heading, content)
      VALUES ('delete', old.id, old.heading, old.content);
      INSERT INTO ref_doc_sections_fts(rowid, heading, content)
      VALUES (new.id, new.heading, new.content);
    END;
  `;
  try { db.exec(triggerSql); } catch { /* triggers already exist */ }

  // Populate FTS indexes from existing data (idempotent — only if empty)
  try {
    const count = (db.prepare("SELECT COUNT(*) as n FROM qa_pairs_fts").get() as { n: number }).n;
    if (count === 0) {
      db.exec(`
        INSERT INTO qa_pairs_fts(rowid, question, answer, summary, question_template)
          SELECT id, question, COALESCE(answer, ''), summary, question_template FROM qa_pairs;
        INSERT INTO kb_articles_fts(rowid, title, content)
          SELECT id, title, content FROM kb_articles;
        INSERT INTO ref_doc_sections_fts(rowid, heading, content)
          SELECT id, heading, content FROM ref_doc_sections;
      `);
    }
  } catch { /* source tables may be empty */ }
}

export function getDb(): Database.Database {
  if (global.__db) return global.__db;

  const dbPath = path.resolve(
    process.cwd(),
    process.env.DATABASE_PATH ?? "./data/kb.db"
  );

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  initDb(db);

  global.__db = db;
  return db;
}
