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

AI_PROVIDER (claude|gemini), ANTHROPIC_API_KEY, GOOGLE_API_KEY, HUBSPOT_ACCESS_TOKEN, DATABASE_PATH, RECLUSTER_THRESHOLD, SYNC_LIMIT, AUTH_SECRET, MASTER_USERNAME, MASTER_PASSWORD, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GMAIL_TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_HUBSPOT_HUB_ID

## UI: 5 tabs

1. **Dashboard** — Insights/prevention queue: ticket trends, customer drill-down, issue cards (auto-generated from recurring tickets), Clarity sync, exec summary
2. **Knowledge Base** — Search + category filters + expandable cards. Sub-tabs: Q&A, Articles, **Reference Docs** (Google Doc imports), **Video Guides** (Loom-derived process cards)
3. **Glossary** — Term management with auto-linking across Q&A, articles, and process cards
4. **Agent** — AI chat with KB context, PDF upload, star ratings, correction flow, email draft generation. Sub-tabs: Chat, Rules (behavioral cards)
5. **Pipeline** — Incremental/full sync + re-clustering + KB scraping (with stale-article deletion via `source_id`), real-time SSE log

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
- **Feature Tour System**: Guided tours for new user-facing features (`src/components/TourEngine.tsx`, `src/lib/tours.ts`), tracked in `tour_completions` table.
- **"What's New" modal**: Highlights recent updates on login.
- **User profile management**: Each user sets Calendly URL, Gmail connection, and other preferences in My Profile.

## Database tables

tickets, qa_pairs, categories, qa_category_map, sync_state, terms, term_qa_map, kb_articles (with `source_id` for dedup), term_article_map, correction_logs, behavioral_cards, ref_docs, ref_doc_sections, process_cards, term_process_card_map, users, conversations, messages, message_ratings, tour_completions, widget_installations, widget_ratings, widget_rate_events, gmail_tokens, clarity_metrics, insight_cache

## Key API routes

**Agent**: `POST /api/agent/chat`, `POST /api/agent/correct`
**Email draft**: `POST /api/agent/email-draft`, `POST /api/agent/email-draft/refine`, `POST /api/agent/email-draft/gmail`, `GET /api/agent/email-draft/hubspot-threads?q=...`, `POST /api/agent/email-draft/hubspot-reply`
**Dashboard/Insights**: `GET /api/dashboard/insights`, `GET /api/dashboard/customer/[slug]`, `POST /api/dashboard/clarity/sync`
**KB content**: `/api/qa`, `/api/articles`, `/api/ref-docs`, `/api/process-cards`, `/api/behavioral-cards`, `/api/terms`, `/api/kb`, `/api/search`, `/api/stats`
**Pipeline**: `GET /api/pipeline` (SSE)
**Conversations**: `/api/conversations`, `/api/conversations/[id]`, `/api/messages`
**Auth/User**: `/api/auth/*`, `/api/tours`, `/api/db`
**Widget (public)**: `/api/widget/config`, `/api/widget/chat`, `/api/widget/rate`, `/api/widget/ticket`
**Widget admin**: `/api/widget-installations`, `/api/widget-installations/[id]`
