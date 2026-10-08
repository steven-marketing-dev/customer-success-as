import { timingSafeEqual } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { Repository } from "@/lib/db/repository";
import { getDb } from "@/lib/db/index";
import {
  ALL_SOURCES,
  DEFAULT_LIMITS,
  formatArticles,
  formatGlossary,
  formatQA,
  formatRefDocs,
  formatRules,
  formatVideoGuides,
  getRules,
  lookupGlossary,
  searchAll,
  searchArticles,
  searchQA,
  searchRefDocs,
  searchVideoGuides,
  type KbSource,
} from "@/lib/kb/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remote MCP server (Streamable HTTP, stateless) exposing the Customer Success KB
 * as read-only tools, so claude.ai / Claude Desktop / Claude Code can query the
 * same source the in-app agent uses.
 *
 * Auth: MCP_ACCESS_TOKEN, sent as `Authorization: Bearer <token>` (Claude Code)
 * or `?key=<token>` in the URL (claude.ai custom connectors, which can't send
 * custom headers). The path is whitelisted in middleware.ts.
 */

const INSTRUCTIONS = `Customer Success knowledge base: Q&A extracted from resolved HubSpot support tickets, public KB articles, a glossary of product terms, internal reference docs, Loom video walkthroughs, and behavioral rules for answering customers.
Start with search_knowledge_base for any customer question; use the narrower tools to dig deeper. Cite KB article URLs and Loom links when you use them, and follow the BEHAVIORAL RULES. If nothing relevant is found, say so instead of guessing.`;

// Hard cap per tool response so one call can't flood the client's context.
const MAX_RESPONSE_CHARS = 40_000;

const text = (t: string) => ({
  content: [{
    type: "text" as const,
    text: t.length > MAX_RESPONSE_CHARS
      ? t.slice(0, MAX_RESPONSE_CHARS) + "\n\n[Response truncated. Use a narrower tool or a smaller limit.]"
      : t,
  }],
});
const readOnly = { readOnlyHint: true, openWorldHint: false };

function buildServer(): McpServer {
  const repo = new Repository(getDb());
  const server = new McpServer({ name: "customer-success-kb", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_knowledge_base",
    {
      title: "Search knowledge base",
      description: "Search every KB source at once (glossary, ticket Q&A, KB articles, reference docs, video guides, behavioral rules). Same context the in-app Customer Success agent uses.",
      inputSchema: {
        query: z.string().min(1).describe("Customer question or keywords"),
        sources: z.array(z.enum(ALL_SOURCES as [KbSource, ...KbSource[]])).optional().describe("Restrict to these sources (default: all)"),
      },
      annotations: readOnly,
    },
    async ({ query, sources }) => text(searchAll(repo, query, sources?.length ? sources : ALL_SOURCES)),
  );

  server.registerTool(
    "search_qa",
    {
      title: "Search ticket Q&A",
      description: "Search Q&A pairs extracted from resolved support tickets, optionally within a category (see list_categories).",
      inputSchema: {
        query: z.string().min(1),
        category: z.string().optional().describe("Category name"),
        limit: z.number().int().min(1).max(30).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, category, limit }) => {
      let categoryId: number | undefined;
      if (category) {
        const cat = repo.getCategoryByName(category);
        if (!cat) return text(`Unknown category "${category}". Use list_categories to see valid names.`);
        categoryId = cat.id;
      }
      return text(formatQA(searchQA(repo, query, limit ?? DEFAULT_LIMITS.qa, categoryId)));
    },
  );

  server.registerTool(
    "search_articles",
    {
      title: "Search KB articles",
      description: "Search public knowledge-base articles (plus articles linked to matching glossary terms). Content is truncated; use get_article for the full text.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(15).optional() },
      annotations: readOnly,
    },
    async ({ query, limit }) => text(formatArticles(searchArticles(repo, query, limit ?? 5), 800)),
  );

  server.registerTool(
    "get_article",
    {
      title: "Get KB article",
      description: "Full content of a KB article by id (the n in [Article:n]).",
      inputSchema: { id: z.number().int() },
      annotations: readOnly,
    },
    async ({ id }) => {
      const a = repo.getKBArticleById(id);
      if (!a) return text(`Article ${id} not found.`);
      return text(`# ${a.title}\nURL: ${a.url}${a.category ? `\nCategory: ${a.category}` : ""}\n\n${a.content}`);
    },
  );

  server.registerTool(
    "lookup_glossary",
    {
      title: "Look up glossary",
      description: "Definitions of product/company terms and their aliases, plus linked KB articles.",
      inputSchema: { term: z.string().min(1) },
      annotations: readOnly,
    },
    async ({ term }) => {
      const terms = lookupGlossary(repo, term);
      const linked = terms.flatMap((t) => repo.getArticlesForTerm(t.id).map((a) => `- ${t.name} → [Article:${a.id}] ${a.title} ${a.url}`));
      return text(formatGlossary(terms) + (linked.length ? `\n\nLinked articles:\n${linked.join("\n")}` : ""));
    },
  );

  server.registerTool(
    "search_reference_docs",
    {
      title: "Search reference docs",
      description: "Search internal reference documents (imported Google Docs), returned by section.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(15).optional() },
      annotations: readOnly,
    },
    async ({ query, limit }) => text(formatRefDocs(searchRefDocs(repo, query, limit ?? DEFAULT_LIMITS.refDocs))),
  );

  server.registerTool(
    "search_video_guides",
    {
      title: "Search video guides",
      description: "Search step-by-step process walkthroughs extracted from Loom training videos.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(10).optional() },
      annotations: readOnly,
    },
    async ({ query, limit }) => text(formatVideoGuides(searchVideoGuides(repo, query, limit ?? DEFAULT_LIMITS.videos))),
  );

  server.registerTool(
    "get_agent_rules",
    {
      title: "Get behavioral rules",
      description: "Behavioral rules the Customer Success agent follows when answering: global rules, plus a category's rules if given.",
      inputSchema: { category: z.string().optional().describe("Category name") },
      annotations: readOnly,
    },
    async ({ category }) => {
      const cat = category ? repo.getCategoryByName(category) : undefined;
      if (category && !cat) return text(`Unknown category "${category}". Use list_categories to see valid names.`);
      return text(formatRules(getRules(repo, cat ? [cat.id] : [])));
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description: "Q&A categories with entry counts.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const cats = repo.getCategorySummary();
      if (cats.length === 0) return text("No categories.");
      return text(cats.map((c) => `- ${c.name} (${c.count})${c.description ? `: ${c.description}` : ""}`).join("\n"));
    },
  );

  return server;
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (!expected) return false;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  if (!process.env.MCP_ACCESS_TOKEN) {
    return Response.json({ error: "MCP_ACCESS_TOKEN not configured" }, { status: 500 });
  }
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
