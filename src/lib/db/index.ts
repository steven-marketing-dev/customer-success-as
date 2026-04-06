import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { hashSync } from "bcryptjs";

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

export interface User {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  calendly_url: string | null;
  role: "master" | "user";
  created_at: number;
}

export interface GmailToken {
  id: number;
  user_id: number;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expiry: number | null;
  gmail_email: string | null;
  created_at: number;
  updated_at: number;
}

export interface Conversation {
  id: number;
  user_id: number;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  sources_json: string | null;
  created_at: number;
}

export interface MessageRating {
  id: number;
  message_id: number;
  user_id: number;
  rating: 1 | 2 | 3;
  feedback: string | null;
  created_at: number;
}

export interface ProcessCard {
  id: number;
  loom_video_id: string;
  loom_url: string;
  title: string;
  summary: string;
  steps: string; // JSON array of strings
  transcript: string | null;
  source_type: string; // 'qa' | 'article' | 'ref_doc'
  source_id: number;
  content_hash: string;
  created_at: number;
  updated_at: number | null;
}

export interface TourCompletion {
  id: number;
  user_id: number;
  tour_key: string;
  completed_at: number;
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

    CREATE TABLE IF NOT EXISTS process_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loom_video_id TEXT NOT NULL,
      loom_url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      steps TEXT NOT NULL,
      transcript TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('qa', 'article', 'ref_doc')),
      source_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_process_cards_video_title ON process_cards(loom_video_id, title);
    CREATE INDEX IF NOT EXISTS idx_process_cards_video ON process_cards(loom_video_id);
    CREATE INDEX IF NOT EXISTS idx_process_cards_source ON process_cards(source_type, source_id);

    CREATE TABLE IF NOT EXISTS term_process_card_map (
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      process_card_id INTEGER NOT NULL REFERENCES process_cards(id) ON DELETE CASCADE,
      PRIMARY KEY (term_id, process_card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_term_pc_map_term ON term_process_card_map(term_id);
    CREATE INDEX IF NOT EXISTS idx_term_pc_map_card ON term_process_card_map(process_card_id);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('master', 'user')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      sources_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS message_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating IN (1, 2, 3)),
      feedback TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(message_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_ratings_message ON message_ratings(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_ratings_rating ON message_ratings(rating);

    CREATE TABLE IF NOT EXISTS tour_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tour_key TEXT NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, tour_key)
    );

    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT NOT NULL,
      token_expiry INTEGER,
      gmail_email TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_gmail_tokens_user ON gmail_tokens(user_id);
  `);

  // Migrations: add columns if they don't exist yet
  const migrations = [
    "ALTER TABLE qa_pairs ADD COLUMN resolution_steps TEXT",
    "ALTER TABLE qa_pairs ADD COLUMN updated_at INTEGER",
    "ALTER TABLE users ADD COLUMN calendly_url TEXT",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // --- FTS5 full-text search indexes ---
  // External-content FTS5: reads directly from source tables via content= option.
  // No triggers needed — call rebuildFtsIndexes() after batch inserts/updates/deletes.
  // Drop old standalone FTS tables and triggers if they exist (migration from trigger-based)
  try {
    for (const name of ["qa_pairs_fts_ai", "qa_pairs_fts_ad", "qa_pairs_fts_au",
      "kb_articles_fts_ai", "kb_articles_fts_ad", "kb_articles_fts_au",
      "ref_doc_sections_fts_ai", "ref_doc_sections_fts_ad", "ref_doc_sections_fts_au"]) {
      db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    }
    // Check if existing FTS table is standalone (no content=) — if so, recreate
    const existingFts = db.prepare("SELECT sql FROM sqlite_master WHERE name='qa_pairs_fts'").get() as { sql: string } | undefined;
    if (existingFts && !existingFts.sql.includes("content=")) {
      db.exec("DROP TABLE IF EXISTS qa_pairs_fts");
      db.exec("DROP TABLE IF EXISTS kb_articles_fts");
      db.exec("DROP TABLE IF EXISTS ref_doc_sections_fts");
    }
  } catch { /* migration cleanup */ }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS qa_pairs_fts USING fts5(
        question, answer, summary, question_template,
        content='qa_pairs', content_rowid='id',
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(
        title, content,
        content='kb_articles', content_rowid='id',
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS ref_doc_sections_fts USING fts5(
        heading, content,
        content='ref_doc_sections', content_rowid='id',
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS process_cards_fts USING fts5(
        title, summary, steps,
        content='process_cards', content_rowid='id',
        tokenize='porter unicode61'
      );
    `);
  } catch { /* FTS tables already exist */ }

  // Build FTS indexes from source tables
  try {
    db.exec("INSERT INTO qa_pairs_fts(qa_pairs_fts) VALUES('rebuild')");
    db.exec("INSERT INTO kb_articles_fts(kb_articles_fts) VALUES('rebuild')");
    db.exec("INSERT INTO ref_doc_sections_fts(ref_doc_sections_fts) VALUES('rebuild')");
    db.exec("INSERT INTO process_cards_fts(process_cards_fts) VALUES('rebuild')");
  } catch { /* source tables may be empty */ }

  // Seed master account if no users exist
  try {
    const userCount = (db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;
    if (userCount === 0) {
      const username = process.env.MASTER_USERNAME ?? "admin";
      const password = process.env.MASTER_PASSWORD ?? "changeme";
      const hash = hashSync(password, 10);
      db.prepare(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)"
      ).run(username, hash, "Administrator", "master");
    }
  } catch { /* users table may not exist yet */ }
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

/** Rebuild all FTS5 indexes from source tables. Call after batch mutations. */
export function rebuildFtsIndexes(db?: ReturnType<typeof getDb>): void {
  const d = db ?? getDb();
  try {
    d.exec("INSERT INTO qa_pairs_fts(qa_pairs_fts) VALUES('rebuild')");
    d.exec("INSERT INTO kb_articles_fts(kb_articles_fts) VALUES('rebuild')");
    d.exec("INSERT INTO ref_doc_sections_fts(ref_doc_sections_fts) VALUES('rebuild')");
    d.exec("INSERT INTO process_cards_fts(process_cards_fts) VALUES('rebuild')");
  } catch { /* tables may not exist yet */ }
}
