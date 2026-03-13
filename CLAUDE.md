# Customer Success KB

Sistema auto-alimentado: HubSpot tickets → Claude extrae Q&A → KB con categorías dinámicas.
Interfaz web con Next.js 15.

## Stack

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS
- **DB**: SQLite via better-sqlite3 (`./data/kb.db`)
- **AI**: Switchable via `AI_PROVIDER` env var — Claude (@anthropic-ai/sdk, default) or Gemini (@google/generative-ai). Provider abstraction in `src/lib/ai/provider.ts`
- **HubSpot**: @hubspot/api-client

## Setup

```bash
npm install
cp .env.example .env.local
# Editar .env.local con tus keys
npm run dev   # → http://localhost:3000
```

## Variables (.env.local)

AI_PROVIDER (claude|gemini), ANTHROPIC_API_KEY, GOOGLE_API_KEY, HUBSPOT_ACCESS_TOKEN, DATABASE_PATH, RECLUSTER_THRESHOLD, SYNC_LIMIT

## UI: 3 pestañas

1. Dashboard — Stats, distribución de categorías, últimas Q&A
2. Knowledge Base — Búsqueda + filtros por categoría + tarjetas expandibles  
3. Pipeline — Sync incremental/completo + re-clustering, log en tiempo real (SSE)
