import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { hashSync } from "bcryptjs";
import { isKnowledgeGapAnswer } from "@/lib/widget-gaps";

// Types

export type RootCause =
  | "ui_friction"
  | "onboarding_gap"
  | "platform_bug"
  | "feature_request"
  | "how_to"
  | "billing"
  | "other";

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
  contact_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  company_id: string | null;
  company_name: string | null;
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
  root_cause: RootCause | null;
}

export interface ClarityMetric {
  id: number;
  fetched_at: number;
  date_bucket: string; // 'YYYY-MM-DD'
  dimension: "Page" | "Browser" | "Device" | "URL";
  dimension_value: string;
  traffic: number;
  rage_click_sessions: number;
  dead_click_sessions: number;
  excessive_scroll_sessions: number;
  quick_back_sessions: number;
  js_error_sessions: number;
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
  source_id: number | null;
  /** Product Fruits lastModified of the published content; null for rows written by the sitemap scraper. */
  source_modified_at: string | null;
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
  email: string | null;
  timezone: string | null;
  report_7d: number; // 0 | 1
  report_30d: number; // 0 | 1
  report_90d: number; // 0 | 1
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

export interface WidgetInstallation {
  id: number;
  key: string;
  name: string;
  allowed_origins: string; // JSON array of strings
  calendly_url: string | null;
  knowledge_base_url: string | null;
  product_name: string | null;
  primary_color: string | null;
  rate_limit_per_hour: number;
  enable_chat: number; // 0 | 1
  enable_email: number; // 0 | 1
  enable_calendly: number; // 0 | 1
  enable_knowledge_base: number; // 0 | 1
  is_active: number; // 0 | 1
  created_at: number;
  updated_at: number;
}

export interface WidgetRating {
  id: number;
  installation_id: number;
  exchange_id: string;
  rating: 1 | 2 | 3;
  feedback: string | null;
  question: string;
  answer: string;
  ip_hash: string;
  session_id: string | null;
  user_email: string | null;
  account: string | null;
  created_at: number;
}

export interface WidgetRateEvent {
  id: number;
  installation_id: number;
  ip_hash: string;
  created_at: number;
}

// follow_up_request: a visitor rated an answer "Not helpful" and left an email to be contacted (DIS-234)
export type WidgetEventType = "kb_click" | "calendly_click" | "email_submit" | "follow_up_request";

export interface WidgetEvent {
  id: number;
  installation_id: number;
  event_type: WidgetEventType;
  source_url: string | null;
  ip_hash: string;
  metadata: string | null; // JSON
  session_id: string | null;
  user_email: string | null;
  account: string | null;
  created_at: number;
}

export interface WidgetQuestion {
  id: number;
  installation_id: number;
  exchange_id: string;
  question: string;
  question_norm: string;
  answer: string;
  articles_json: string; // JSON array of {id,title,url}
  ip_hash: string;
  session_id: string | null;
  user_email: string | null;
  account: string | null;
  status: "ok" | "error" | "unanswered";
  created_at: number;
}

export interface WidgetArticleClick {
  id: number;
  installation_id: number;
  question_id: number | null;
  article_id: number | null;
  article_title: string;
  article_url: string;
  ip_hash: string;
  session_id: string | null;
  user_email: string | null;
  account: string | null;
  created_at: number;
}

/** Anonymous widget visitor context sent by the iframe with every call. */
export interface WidgetVisitorContext {
  session_id: string | null;
  user_email: string | null;
  account: string | null;
}

export type WidgetMeetingStatus = "scheduled" | "held" | "canceled" | "no_show";

export interface WidgetMeeting {
  id: number;
  invitee_uri: string;
  event_uri: string;
  installation_id: number | null;
  session_id: string | null;
  invitee_email: string | null;
  invitee_name: string | null;
  event_name: string | null;
  booked_at: number;
  start_time: number;
  end_time: number;
  event_status: "active" | "canceled";
  no_show: number; // 0 | 1
  synced_at: number;
}

/** The HubSpot ticket a widget email or follow-up request turned into (matched by subject and time). */
export interface WidgetHubspotTicket {
  id: number;
  event_id: number;
  hubspot_ticket_id: string | null;
  status: "open" | "closed" | "not_found";
  ticket_created_at: number | null;
  closed_at: number | null;
  /** Subject the visitor typed (from the ticket's incoming email, else the ticket's own subject); "" when none */
  subject: string | null;
  visitor_email: string | null;
  attempts: number;
  checked_at: number;
}

export interface WidgetReportSend {
  id: number;
  user_id: number;
  period_days: number;
  period_start: number;
  period_end: number;
  status: "sending" | "sent" | "failed";
  attempts: number;
  error: string | null;
  sent_at: number | null;
  created_at: number;
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

    CREATE TABLE IF NOT EXISTS widget_installations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      allowed_origins TEXT NOT NULL DEFAULT '[]',
      calendly_url TEXT,
      knowledge_base_url TEXT,
      product_name TEXT,
      primary_color TEXT,
      rate_limit_per_hour INTEGER NOT NULL DEFAULT 60,
      enable_chat INTEGER NOT NULL DEFAULT 1,
      enable_email INTEGER NOT NULL DEFAULT 1,
      enable_calendly INTEGER NOT NULL DEFAULT 1,
      enable_knowledge_base INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_installations_key ON widget_installations(key);
    CREATE INDEX IF NOT EXISTS idx_widget_installations_active ON widget_installations(is_active);

    CREATE TABLE IF NOT EXISTS widget_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL REFERENCES widget_installations(id) ON DELETE CASCADE,
      exchange_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating IN (1, 2, 3)),
      feedback TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(installation_id, exchange_id)
    );
    CREATE INDEX IF NOT EXISTS idx_widget_ratings_installation ON widget_ratings(installation_id);
    CREATE INDEX IF NOT EXISTS idx_widget_ratings_rating ON widget_ratings(rating);
    CREATE INDEX IF NOT EXISTS idx_widget_ratings_created ON widget_ratings(created_at);

    CREATE TABLE IF NOT EXISTS widget_rate_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL REFERENCES widget_installations(id) ON DELETE CASCADE,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_rate_events_install_created ON widget_rate_events(installation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_rate_events_ip_created ON widget_rate_events(ip_hash, created_at);

    CREATE TABLE IF NOT EXISTS widget_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL REFERENCES widget_installations(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      source_url TEXT,
      ip_hash TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_events_install_type_created ON widget_events(installation_id, event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_events_install_created ON widget_events(installation_id, created_at);

    CREATE TABLE IF NOT EXISTS widget_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL REFERENCES widget_installations(id) ON DELETE CASCADE,
      exchange_id TEXT NOT NULL,
      question TEXT NOT NULL,
      question_norm TEXT NOT NULL,
      answer TEXT NOT NULL,
      articles_json TEXT NOT NULL DEFAULT '[]',
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_questions_install_created ON widget_questions(installation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_questions_install_norm ON widget_questions(installation_id, question_norm);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_widget_questions_exchange ON widget_questions(installation_id, exchange_id);

    CREATE TABLE IF NOT EXISTS widget_article_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL REFERENCES widget_installations(id) ON DELETE CASCADE,
      question_id INTEGER REFERENCES widget_questions(id) ON DELETE SET NULL,
      article_id INTEGER,
      article_title TEXT NOT NULL,
      article_url TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_article_clicks_install_created ON widget_article_clicks(installation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_article_clicks_install_url ON widget_article_clicks(installation_id, article_url);

    CREATE TABLE IF NOT EXISTS widget_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invitee_uri TEXT UNIQUE NOT NULL,
      event_uri TEXT NOT NULL,
      installation_id INTEGER REFERENCES widget_installations(id) ON DELETE SET NULL,
      session_id TEXT,
      invitee_email TEXT,
      invitee_name TEXT,
      event_name TEXT,
      booked_at INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      event_status TEXT NOT NULL DEFAULT 'active',
      no_show INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_widget_meetings_booked ON widget_meetings(booked_at);
    CREATE INDEX IF NOT EXISTS idx_widget_meetings_start ON widget_meetings(start_time);

    -- Calendly events already inspected, so each event's invitees are fetched once
    CREATE TABLE IF NOT EXISTS calendly_events_seen (
      event_uri TEXT PRIMARY KEY,
      start_time INTEGER NOT NULL,
      checked_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- One row per (user, report length, period): the UNIQUE key makes sending idempotent
    CREATE TABLE IF NOT EXISTS widget_report_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_days INTEGER NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',
      attempts INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      sent_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, period_days, period_end)
    );

    -- HubSpot ticket for each widget email / follow-up request (widget_events row), refreshed by
    -- src/lib/widget-tickets.ts so the usage report can say whether a follow-up was handled
    CREATE TABLE IF NOT EXISTS widget_hubspot_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER UNIQUE NOT NULL REFERENCES widget_events(id) ON DELETE CASCADE,
      hubspot_ticket_id TEXT,
      status TEXT NOT NULL,
      ticket_created_at INTEGER,
      closed_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 1,
      checked_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS clarity_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at INTEGER NOT NULL,
      date_bucket TEXT NOT NULL,
      dimension TEXT NOT NULL,
      dimension_value TEXT NOT NULL,
      traffic INTEGER NOT NULL DEFAULT 0,
      rage_click_sessions INTEGER NOT NULL DEFAULT 0,
      dead_click_sessions INTEGER NOT NULL DEFAULT 0,
      excessive_scroll_sessions INTEGER NOT NULL DEFAULT 0,
      quick_back_sessions INTEGER NOT NULL DEFAULT 0,
      js_error_sessions INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date_bucket, dimension, dimension_value)
    );
    CREATE INDEX IF NOT EXISTS idx_clarity_metrics_date ON clarity_metrics(date_bucket);

    CREATE TABLE IF NOT EXISTS insight_cache (
      date_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (date_key, content_hash)
    );
  `);

  // Migrations: add columns if they don't exist yet
  const migrations = [
    "ALTER TABLE qa_pairs ADD COLUMN resolution_steps TEXT",
    "ALTER TABLE qa_pairs ADD COLUMN updated_at INTEGER",
    "ALTER TABLE users ADD COLUMN calendly_url TEXT",
    "ALTER TABLE widget_installations ADD COLUMN enable_chat INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE widget_installations ADD COLUMN enable_email INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE widget_installations ADD COLUMN enable_calendly INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE widget_installations ADD COLUMN knowledge_base_url TEXT",
    "ALTER TABLE widget_installations ADD COLUMN enable_knowledge_base INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tickets ADD COLUMN contact_id TEXT",
    "ALTER TABLE tickets ADD COLUMN contact_email TEXT",
    "ALTER TABLE tickets ADD COLUMN contact_name TEXT",
    "ALTER TABLE tickets ADD COLUMN company_id TEXT",
    "ALTER TABLE tickets ADD COLUMN company_name TEXT",
    "ALTER TABLE qa_pairs ADD COLUMN root_cause TEXT",
    "ALTER TABLE kb_articles ADD COLUMN source_id INTEGER",
    "ALTER TABLE kb_articles ADD COLUMN source_modified_at TEXT",
    "ALTER TABLE users ADD COLUMN email TEXT",
    "ALTER TABLE users ADD COLUMN timezone TEXT",
    "ALTER TABLE users ADD COLUMN report_7d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN report_30d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN report_90d INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE widget_questions ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'",
    "ALTER TABLE widget_hubspot_tickets ADD COLUMN subject TEXT",
    "ALTER TABLE widget_hubspot_tickets ADD COLUMN visitor_email TEXT",
    ...["widget_questions", "widget_ratings", "widget_events", "widget_article_clicks"].flatMap((t) => [
      `ALTER TABLE ${t} ADD COLUMN session_id TEXT`,
      `ALTER TABLE ${t} ADD COLUMN user_email TEXT`,
      `ALTER TABLE ${t} ADD COLUMN account TEXT`,
    ]),
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  for (const t of ["widget_questions", "widget_ratings", "widget_events", "widget_article_clicks"]) {
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_session ON ${t}(session_id)`); } catch { /* exists */ }
  }

  // Date from which session/identity/subject/meeting tracking exists (DIS-234). Set once,
  // on the first boot with this schema; reports label older data "Not available".
  try {
    db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('widget_tracking_v2_since', ?)")
      .run(String(Math.floor(Date.now() / 1000)));
  } catch { /* table may not exist yet */ }

  // Visitor emails read from HubSpot before the parser dropped mail clients' "<mailto:...>" suffix
  try {
    db.exec("UPDATE widget_hubspot_tickets SET visitor_email = substr(visitor_email, 1, instr(visitor_email, '<') - 1) WHERE instr(visitor_email, '<') > 1");
  } catch { /* table may not exist yet */ }

  // Mark past widget answers where the agent had no documented guidance (DIS-234). Once.
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key = 'widget_gap_backfill'").get()) {
      const mark = db.prepare("UPDATE widget_questions SET status = 'unanswered' WHERE id = ?");
      db.transaction(() => {
        for (const q of db.prepare("SELECT id, answer FROM widget_questions WHERE status = 'ok'").all() as Array<{ id: number; answer: string }>) {
          if (isKnowledgeGapAnswer(q.answer)) mark.run(q.id);
        }
        db.prepare("INSERT INTO app_meta (key, value) VALUES ('widget_gap_backfill', ?)").run(String(Math.floor(Date.now() / 1000)));
      })();
    }
  } catch { /* table may not exist yet */ }

  // Gap queue (DIS-234): what CS did with a question the widget agent couldn't answer, per
  // normalized question. A newer unanswered question with the same text reopens it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS widget_gap_reviews (
      question_norm TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('answered', 'dismissed')),
      qa_id INTEGER REFERENCES qa_pairs(id) ON DELETE SET NULL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Unique index on source_id (NULLs allowed for legacy rows pending backfill).
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_articles_source_id ON kb_articles(source_id) WHERE source_id IS NOT NULL");
  } catch { /* index already exists */ }

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
