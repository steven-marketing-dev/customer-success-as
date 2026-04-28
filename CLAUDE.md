# Customer Success KB

Self-feeding system: HubSpot tickets → Claude extracts Q&A → KB with dynamic categories.
Web interface with Next.js 15.

## Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS
- **DB**: SQLite via better-sqlite3 (`./data/kb.db`)
- **AI**: Switchable via `AI_PROVIDER` env var — Claude (@anthropic-ai/sdk, default) or Gemini (@google/generative-ai). Provider abstraction in `src/lib/ai/provider.ts`
- **HubSpot**: @hubspot/api-client (CRM) + raw fetch for Conversations Inbox (thread search + reply)
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

- **Calendly integration**: Each user sets their Calendly URL in My Profile. The agent includes it when suggesting meetings. Also embedded at the end of generated email drafts (after the articles section).
- **Email Draft Composer Modal**: "Email" button (mint-colored pill) on each agent response opens a composer modal with:
  - AI-generated subject + body (editable)
  - AI refinement bar — user types instructions (e.g., "make it shorter") and AI updates the draft in place
  - KB articles from the response are included as a "Helpful Resources" section
  - No sign-off/signature (the email client's own signature handles that)
  - Two destinations: **Save as Gmail Draft** (creates draft in user's Gmail via OAuth) or **Reply via HubSpot** (posts reply to a selected Conversations Inbox thread)
  - Clicking outside the modal does NOT close it (prevents accidental work loss)
- **HubSpot Conversations reply**: Thread picker searches the HubSpot Conversations Inbox (paginates through threads, filters to OPEN status, sorts by most recent activity). User selects a thread and replies with the drafted email. Uses `POST /conversations/v3/conversations/threads/{id}/messages`.
- **Compact action bar**: Agent responses show stars, collapsible reference count (refs toggle), email, and correct actions on a single row.
- **PDF upload**: Attach PDF reports to agent questions via paperclip button (max 10MB).
- **Behavioral rules**: Global and category-scoped rules that guide agent behavior. Can be auto-suggested from correction feedback.
- **Process cards**: Step-by-step walkthroughs extracted from Loom training videos.
- **Embeddable widget**: `/embed/chat` route exposes a chat widget for external sites. Uses `HelpCircle` icon (question mark) to signal a help/support context, distinct from the internal `Bot` icon used in the main Agent tab.

## API routes (email draft flow)

- `POST /api/agent/email-draft` — generate initial draft (returns `{ subject, body }`, includes cited KB articles)
- `POST /api/agent/email-draft/refine` — AI refinement ({ messageId, subject, body, instruction } → updated draft)
- `POST /api/agent/email-draft/gmail` — create Gmail draft from final subject + body
- `GET /api/agent/email-draft/hubspot-threads?q=...` — search HubSpot Conversations Inbox (OPEN threads only)
- `POST /api/agent/email-draft/hubspot-reply` — post reply to a selected thread
