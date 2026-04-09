# Customer Success KB

Self-feeding system: HubSpot tickets → Claude extracts Q&A → KB with dynamic categories.
Web interface with Next.js 15.

## Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS
- **DB**: SQLite via better-sqlite3 (`./data/kb.db`)
- **AI**: Switchable via `AI_PROVIDER` env var — Claude (@anthropic-ai/sdk, default) or Gemini (@google/generative-ai). Provider abstraction in `src/lib/ai/provider.ts`
- **HubSpot**: @hubspot/api-client
- **Gmail**: googleapis — OAuth2 per user, `users.drafts.create` for email draft generation. Tokens encrypted at rest (AES-256-GCM).

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your keys
npm run dev   # → http://localhost:3000
```

## Variables (.env.local)

AI_PROVIDER (claude|gemini), ANTHROPIC_API_KEY, GOOGLE_API_KEY, HUBSPOT_ACCESS_TOKEN, DATABASE_PATH, RECLUSTER_THRESHOLD, SYNC_LIMIT, AUTH_SECRET, MASTER_USERNAME, MASTER_PASSWORD, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GMAIL_TOKEN_ENCRYPTION_KEY

## UI: 5 tabs

1. **Dashboard** — Stats, category distribution, latest Q&A
2. **Knowledge Base** — Search + category filters + expandable cards (Q&A, Articles, Video Guides sub-tabs)
3. **Glossary** — Term management with auto-linking
4. **Agent** — AI chat with KB context, PDF upload, star ratings, correction flow, email draft generation (sub-tabs: Chat, Rules)
5. **Pipeline** — Incremental/full sync + re-clustering + KB scraping, real-time SSE log

## Key features

- **Calendly integration**: Each user sets their Calendly URL in My Profile. The agent includes it when suggesting meetings. Also embedded in generated email drafts.
- **Email draft generation**: "Email" button on each agent response. Generates subject + body via AI, creates a draft in the user's Gmail via OAuth2. Requires Gmail connection in My Profile.
- **Compact action bar**: Agent responses show stars, collapsible reference count, email, and correct actions on a single row.
- **PDF upload**: Attach PDF reports to agent questions via paperclip button (max 10MB).
- **Behavioral rules**: Global and category-scoped rules that guide agent behavior. Can be auto-suggested from correction feedback.
- **Process cards**: Step-by-step walkthroughs extracted from Loom training videos.
