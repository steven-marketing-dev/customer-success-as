# Customer Success KB

Self-feeding system: HubSpot tickets → Claude extracts Q&A → KB with dynamic categories.
Web interface with Next.js 15.

## Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS + lucide-react icons
- **DB**: SQLite via better-sqlite3 (`./data/kb.db`)
- **AI**: Switchable via `AI_PROVIDER` env var — Claude (@anthropic-ai/sdk, default) or Gemini (@google/generative-ai). Provider abstraction in `src/lib/ai/provider.ts`
- **HubSpot**: @hubspot/api-client (CRM tickets) + raw fetch for Conversations Inbox (thread search, reply, message fetching)
- **Gmail**: googleapis — OAuth2 per user, `users.drafts.create` for email draft generation. Tokens encrypted at rest (AES-256-GCM)
- **Auth**: bcryptjs + jose (JWT sessions), master credentials + per-user accounts
- **PDF**: pdf-parse for extracting text from uploaded PDF reports
- **Analytics**: Microsoft Clarity API client (`src/lib/clarity.ts`) for behavioral insights
- **Imports**: Google Docs (`src/lib/gdoc-importer.ts`, fetched as HTML to preserve links), Loom video transcripts (`src/lib/loom-fetcher.ts`)

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your keys
npm run dev   # → http://localhost:3000
```

## Variables (.env.local)

AI_PROVIDER (claude|gemini), ANTHROPIC_API_KEY, GOOGLE_API_KEY, HUBSPOT_ACCESS_TOKEN, DATABASE_PATH, RECLUSTER_THRESHOLD, SYNC_LIMIT, AUTH_SECRET, MASTER_USERNAME, MASTER_PASSWORD, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GMAIL_TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_HUBSPOT_HUB_ID, MCP_ACCESS_TOKEN, PRODUCT_FRUITS_API_TOKEN, KB_SYNC_INTERVAL_HOURS, WIDGET_REPORTS_ENABLED, REPORTS_FROM, WIDGET_REPORTS_ANCHOR, CALENDLY_API_TOKEN, CALENDLY_ORG

## UI: 5 tabs

1. **Dashboard** — Insights/prevention queue: ticket trends, customer drill-down, issue cards (auto-generated from recurring tickets), Clarity sync, exec summary
2. **Knowledge Base** — Search + category filters + expandable cards. Sub-tabs: Q&A, Articles, **Reference Docs** (Google Doc imports), **Video Guides** (Loom-derived process cards)
3. **Glossary** — Term management with auto-linking across Q&A, articles, and process cards
4. **Agent** — AI chat with KB context, PDF upload, star ratings, correction flow, email draft generation. Sub-tabs: Chat, Rules (behavioral cards)
5. **Pipeline** — Incremental/full sync + re-clustering + KB sync ("Scrape KB": Product Fruits API when `PRODUCT_FRUITS_API_TOKEN` is set, sitemap scraper as fallback; stale-article deletion via `source_id`), real-time SSE log

## Key features

- **Calendly integration**: Each user sets their Calendly URL in My Profile. Agent includes it when suggesting meetings, and it's embedded at the end of generated email drafts (after the articles section).
- **Email Draft Composer Modal**: "Email" button (mint-colored pill) on each agent response opens a composer modal with:
  - AI-generated subject + body (editable)
  - AI refinement bar — user types instructions (e.g., "make it shorter") and AI updates the draft in place
  - KB articles from the response are included as a "Helpful Resources" section
  - No sign-off/signature (the email client's own signature handles that)
  - Two destinations: **Save as Gmail Draft** (creates draft in user's Gmail via OAuth) or **Reply via HubSpot** (posts reply to a selected Conversations Inbox thread)
  - Clicking outside the modal does NOT close it (prevents accidental work loss)
- **HubSpot Conversations reply**: Thread picker searches the HubSpot Conversations Inbox (paginates through threads, filters to OPEN status, sorts by most recent activity, fetches sender details and preview). User selects a thread and replies with the drafted email. Uses `POST /conversations/v3/conversations/threads/{id}/messages`.
- **Compact action bar**: Agent responses show stars, collapsible reference count (refs toggle), email, and correct actions on a single row.
- **PDF upload**: Attach PDF reports to agent questions via paperclip button (max 10MB), parsed with pdf-parse.
- **Behavioral rules**: Global and category-scoped rules that guide agent behavior. Can be auto-suggested from correction feedback.
- **Process cards**: Step-by-step walkthroughs extracted from Loom training videos via `src/lib/ai/processCardExtractor.ts`.
- **Reference Docs**: Imported from Google Docs as HTML (preserves hyperlinks), sectioned and AI-summarized for agent context.
- **Issue Cards**: AI-clustered recurring customer issues surfaced on the dashboard (`src/lib/insights/issueCards.ts`), with URL pattern matching against Clarity behavioral data.
- **Customer drill-down**: `/api/dashboard/customer/[slug]` returns per-customer ticket history and exec summary.
- **Microsoft Clarity sync**: Pulls behavioral metrics into `clarity_metrics` table for correlation with tickets.
- **Embeddable widget**: `/embed/chat` route exposes a chat widget for external sites. Uses `HelpCircle` icon to signal a help/support context. Widget installations managed via the **Widget Installations** panel — each install gets a key, optional KB URL toggle, and rate-limited chat/ticket endpoints. Public origin derived from `GOOGLE_OAUTH_REDIRECT_URI` / forwarded headers for proxy scenarios.
- **Widget usage reports (DIS-234)**: Email report every 7, 30 and 90 days (exact windows of local days counted from `WIDGET_REPORTS_ANCHOR`), opted in per user in **My Profile → Email reports** (email, timezone, 3 toggles; masters can set them for anyone in Manage Users). Covers all installations: meetings booked/held, KB visits, emails sent, ratings, questions with resolved/follow-up, plus a CSV of every record. Builder `src/lib/widget-usage-report.ts`, hourly job `src/lib/widget-report-scheduler.ts` (on with `WIDGET_REPORTS_ENABLED=1`; `widget_report_sends` UNIQUE(user, length, period_end) keeps it idempotent), sender `src/lib/email/reports.ts`. Preview (master): `GET /api/widget-reports/preview?days=7[&format=csv]`, `POST` emails it to yourself only. **Send report now** (master, Manage Users): `POST /api/widget-reports/send` `{ userIds, days | from+to }` emails it right away to chosen users for the last 7/30/90 days or custom dates (max 92 days, in each recipient's timezone); it doesn't touch `widget_report_sends`, so the schedule is unaffected.
- **Widget visitor tracking**: the iframe sends an anonymous per-tab `sessionId` (sessionStorage) with every call, plus `userEmail`/`account` when the host page sets `data-user-email` / `data-account` on the widget.js tag; stored on `widget_questions`, `widget_ratings`, `widget_events`, `widget_article_clicks`. Calendly links handed out by the widget carry `utm_source=cs-widget`, `utm_medium=installation-<id>`, `utm_content=<session>`; `src/lib/widget-meetings.ts` reads them back from the Calendly API into `widget_meetings` (held = ended, active, not no-show). `app_meta.widget_tracking_v2_since` records when this tracking started.
- **Feature Tour System**: Guided tours for new user-facing features (`src/components/TourEngine.tsx`, `src/lib/tours.ts`), tracked in `tour_completions` table.
- **"What's New" modal**: Highlights recent updates on login.
- **User profile management**: Each user sets Calendly URL, Gmail connection, and other preferences in My Profile.

## Database tables

tickets, qa_pairs, categories, qa_category_map, sync_state, terms, term_qa_map, kb_articles (with `source_id` for dedup), term_article_map, correction_logs, behavioral_cards, ref_docs, ref_doc_sections, process_cards, term_process_card_map, users, conversations, messages, message_ratings, tour_completions, widget_installations, widget_ratings, widget_rate_events, widget_events, widget_questions, widget_article_clicks, widget_meetings, calendly_events_seen, widget_report_sends, app_meta, gmail_tokens, clarity_metrics, insight_cache

## Key API routes

**Agent**: `POST /api/agent/chat`, `POST /api/agent/correct`
**Email draft**: `POST /api/agent/email-draft`, `POST /api/agent/email-draft/refine`, `POST /api/agent/email-draft/gmail`, `GET /api/agent/email-draft/hubspot-threads?q=...`, `POST /api/agent/email-draft/hubspot-reply`
**Dashboard/Insights**: `GET /api/dashboard/insights`, `GET /api/dashboard/customer/[slug]`, `POST /api/dashboard/clarity/sync`
**KB content**: `/api/qa`, `/api/articles`, `/api/ref-docs`, `/api/process-cards`, `/api/behavioral-cards`, `/api/terms`, `/api/kb`, `/api/search`, `/api/stats`
**Pipeline**: `GET /api/pipeline` (SSE)
**KB sync (machine, `x-api-key` = N8N_API_KEY)**: `POST /api/kb/sync` `{ dryRun? }` — incremental sync from the Product Fruits KB API (`src/lib/productFruits.ts`); also scheduled every `KB_SYNC_INTERVAL_HOURS` (default 6) by `src/instrumentation-node.ts` in production
**Conversations**: `/api/conversations`, `/api/conversations/[id]`, `/api/messages`
**Auth/User**: `/api/auth/*`, `/api/tours`, `/api/db`
**Widget (public)**: `/api/widget/config`, `/api/widget/chat`, `/api/widget/rate`, `/api/widget/ticket`
**Widget admin**: `/api/widget-installations`, `/api/widget-installations/[id]`, `/api/widget-reports/preview`, `/api/widget-reports/send` (master)
**MCP (public, token auth)**: `/api/mcp`

## MCP server (connect Claude to the KB)

`src/app/api/mcp/route.ts` is a remote MCP server (Streamable HTTP, stateless). It exposes the KB as read-only tools: `search_knowledge_base`, `search_qa`, `search_articles`, `get_article`, `lookup_glossary`, `search_reference_docs`, `search_video_guides`, `get_agent_rules`, `list_categories`. Retrieval and formatting live in `src/lib/kb/retrieval.ts` and mirror the in-app agent's context.

- Auth uses `MCP_ACCESS_TOKEN`, sent as `Authorization: Bearer <token>` or `?key=<token>`.
- **claude.ai / Desktop / mobile**: go to Settings → Connectors → Add custom connector and use the URL `https://<host>/api/mcp?key=<MCP_ACCESS_TOKEN>`.
- **Claude Code**: `claude mcp add --transport http cs-kb https://<host>/api/mcp --header "Authorization: Bearer <MCP_ACCESS_TOKEN>"`
