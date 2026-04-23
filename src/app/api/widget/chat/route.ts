import { NextRequest } from "next/server";
import crypto from "crypto";
import { Repository } from "@/lib/db/repository";
import { getDb, type QAPair } from "@/lib/db/index";
import { streamChat, type ChatMessage } from "@/lib/ai/provider";
import { corsHeaders, resolveInstallation, checkAndRecordRate, hashIp, extractClientIp } from "@/lib/widget-auth";

export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 20;

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const resolution = resolveInstallation(req);
  if ("error" in resolution) return resolution.error;
  const { installation, matchedOrigin } = resolution;

  const cors = corsHeaders(matchedOrigin);

  // Rate limit per installation + IP hash
  const ipHash = hashIp(extractClientIp(req));
  const rate = checkAndRecordRate(installation.id, ipHash, installation.rate_limit_per_hour);
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(rate.retryAfter ?? 60), ...cors },
    });
  }

  // JSON only (no PDF upload for anonymous widget)
  let question: string;
  let history: ChatMessage[] = [];
  try {
    const body = await req.json() as { question?: string; history?: ChatMessage[] };
    question = (body.question ?? "").trim();
    if (Array.isArray(body.history)) {
      history = body.history
        .slice(-MAX_HISTORY_MESSAGES)
        .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_LENGTH) }));
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  if (!question) {
    return new Response(JSON.stringify({ error: "Missing question" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return new Response(JSON.stringify({ error: `Question too long (max ${MAX_QUESTION_LENGTH} chars)` }), {
      status: 413, headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const repo = new Repository(getDb());

  // KB retrieval — unchanged, KB is global per user decision
  const results = repo.searchByKeywords(question, 8);
  const searchedArticles = repo.searchKBArticles(question, 3);
  const matchedTerms = repo.getMatchingTermsForQuery(question);

  const seenArticleIds = new Set(searchedArticles.map((a) => a.id));
  const termLinkedArticles = matchedTerms.flatMap((t) => repo.getArticlesForTerm(t.id));
  for (const a of termLinkedArticles) {
    if (!seenArticleIds.has(a.id)) { searchedArticles.push(a); seenArticleIds.add(a.id); }
  }
  const articles = searchedArticles;

  let globalRules: Awaited<ReturnType<typeof repo.getGlobalBehavioralCards>> = [];
  let categoryRules: typeof globalRules = [];
  try {
    globalRules = repo.getGlobalBehavioralCards();
    const matchedCategoryIds = [...new Set(
      results.map((qa) => (qa as unknown as Record<string, unknown>).category_id as number | undefined)
        .filter((id): id is number => id != null)
    )];
    categoryRules = matchedCategoryIds.length > 0 ? repo.getBehavioralCardsForCategories(matchedCategoryIds) : [];
  } catch { /* table may not exist yet */ }

  let refDocSections: Awaited<ReturnType<typeof repo.searchRefDocSections>> = [];
  try { refDocSections = repo.searchRefDocSections(question, 6); } catch { /* ignore */ }

  let processCards: Awaited<ReturnType<typeof repo.searchProcessCards>> = [];
  try { processCards = repo.searchProcessCards(question, 3); } catch { /* ignore */ }

  const glossaryContext = matchedTerms.length > 0
    ? matchedTerms.map((t) => {
        const aliases: string[] = JSON.parse(t.aliases || "[]");
        let entry = `• ${t.name}: ${t.definition}`;
        if (aliases.length > 0) entry += ` (also: ${aliases.join(", ")})`;
        return entry;
      }).join("\n")
    : "";

  const articlesContext = articles.length > 0
    ? articles.map((a) => {
        const truncated = a.content.length > 2000 ? a.content.slice(0, 2000) + "..." : a.content;
        return `[Article:${a.id}] ${a.title} ${a.url}${a.category ? ` (${a.category})` : ""}\n${truncated}`;
      }).join("\n\n")
    : "";

  const refDocsContext = refDocSections.length > 0
    ? refDocSections.map((s) => {
        const truncated = s.content.length > 2000 ? s.content.slice(0, 2000) + "..." : s.content;
        return `[REF:${s.id}] ${s.doc_title} > ${s.heading}\n${truncated}`;
      }).join("\n\n")
    : "";

  const processCardsContext = processCards.length > 0
    ? processCards.map((pc) => {
        let steps: string[] = [];
        try { steps = JSON.parse(pc.steps); } catch { /* */ }
        return `[VIDEO:${pc.id}] ${pc.title}\nSummary: ${pc.summary}\nSteps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\nVideo: ${pc.loom_url}`;
      }).join("\n\n")
    : "";

  const context = results.length > 0
    ? results.map((qa) => {
        const qaCast = qa as QAPair & { category_name?: string; resolution_steps?: string; question_variables?: string };
        let entry = `[ID:${qa.id}] Category: ${qa.category_name ?? "Uncategorized"}\nQ: ${qa.question}`;
        if (qaCast.question_template && qaCast.question_template !== qa.question) entry += `\nPattern: ${qaCast.question_template}`;
        if (qaCast.question_variables) {
          try {
            const vars = JSON.parse(qaCast.question_variables);
            if (Object.keys(vars).length > 0) entry += `\nVariables: ${JSON.stringify(vars)}`;
          } catch { /* ignore */ }
        }
        entry += `\nA: ${qa.answer ?? qa.summary ?? "(no answer recorded)"}`;
        entry += `\nResolved: ${qa.resolved ? "Yes" : "No"}`;
        const steps: string[] = (() => {
          try { return JSON.parse(qaCast.resolution_steps ?? "[]"); } catch { return []; }
        })();
        if (steps.length > 0) entry += `\nResolution Steps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
        return entry;
      }).join("\n\n")
    : "No relevant entries found in the knowledge base.";

  const productName = installation.product_name || "this product";

  const system = `You are the help assistant for ${productName}. You are speaking directly to a user of ${productName} — be friendly, concise, and practical. Answer based ONLY on the knowledge base entries and documentation provided below.

IMPORTANT — Pattern-based reasoning:
- Some entries include a "Pattern" field (e.g., "How do I schedule a meeting for {{service_name}}?") and "Variables".
- The Pattern shows the generalized form of the question. The same solution can apply to different variable values.
- Think about the underlying process or workflow, not just the specific entity mentioned.

Rules:
- Address the user directly ("you", not "the customer" or "the user")
- Answer concisely based on the provided knowledge base entries and documentation
- Use the glossary to explain product-specific terminology when helpful
- Reference documentation (Articles) for how-to content and feature explanations
- Reference documents (marked [REF:N]) contain authoritative training materials. Use them when relevant.
- When the exact topic isn't in the KB but a similar pattern exists, adapt the answer
- If the question truly cannot be answered from the provided entries, say so clearly and suggest the user contact support — do not guess or invent information
- Do not reference internal processes, teammate workflows, or anything that sounds like it's meant for support staff rather than end users
- ARTICLE LINKS: When articles are provided in the DOCUMENTATION section below, you MUST reference at least one. At the END of your response (before the SOURCES/REFS/ARTICLES lines), add a brief closing line with article links:
  - For 1 article: "For more details, see [Article Title](URL)."
  - For 2+ articles: "For more information, here are some helpful articles:" followed by a list: - [Article Title](URL)
  Use ONLY articles provided in the DOCUMENTATION section. The article URLs are in each article's header line as [Article:ID] Title URL.
- CITATION RULES: At the very end of your response (AFTER the helpful articles section if present), output these four lines exactly:
  SOURCES:[id1,id2,...] (IDs of Q&A entries [ID:N] you used, or SOURCES:[] if none)
  REFS:[id1,id2,...] (IDs of reference document sections [REF:N] you used, or REFS:[] if none)
  ARTICLES:[id1,id2,...] (IDs of articles [Article:N] you referenced — MUST NOT be empty if DOCUMENTATION section was provided above)
  VIDEOS:[id1,id2,...] (IDs of video walkthrough entries [VIDEO:N] you used, or VIDEOS:[] if none)
${(() => {
  const rules: string[] = [];
  for (const r of globalRules) rules.push(`[GLOBAL${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);
  for (const r of categoryRules) rules.push(`[CATEGORY${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);
  return rules.length > 0 ? `
--- BEHAVIORAL RULES ---
Follow these rules when formulating your response. Category rules apply only when the question relates to that category. KNOWLEDGE means the user wants understanding. SOLUTION means the user wants actionable steps.
${rules.join("\n")}
--- END BEHAVIORAL RULES ---` : "";
})()}
${installation.calendly_url ? `
--- SCHEDULING ---
Support scheduling link: ${installation.calendly_url}
When a call or meeting with the support team is genuinely relevant to the user's question, include this link using the format: [Schedule a call](${installation.calendly_url})
Do NOT fabricate or modify this URL. Only include it when a meeting is genuinely helpful — do not add it to every answer.
--- END SCHEDULING ---` : ""}
${glossaryContext ? `
--- GLOSSARY ---
${glossaryContext}
--- END GLOSSARY ---` : ""}
${refDocsContext ? `
--- REFERENCE DOCUMENTS ---
${refDocsContext}
--- END REFERENCE DOCUMENTS ---` : ""}
${articlesContext ? `
--- DOCUMENTATION (${articles.length} public KB article${articles.length !== 1 ? "s" : ""} — you MUST link at least one below your answer) ---
${articlesContext}
--- END DOCUMENTATION ---` : ""}
${processCardsContext ? `
--- VIDEO WALKTHROUGHS ---
${processCardsContext}
--- END VIDEO WALKTHROUGHS ---` : ""}

--- SUPPORT Q&A (past resolved cases) ---
${context}
--- END SUPPORT Q&A ---`;

  const exchangeId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let fullText = "";
        for await (const text of streamChat(system, history, question)) {
          fullText += text;
          send({ type: "delta", text });
        }

        const sourcesMatch = fullText.match(/SOURCES:\s*\[([^\]]*)\]/m);
        const usedIds = sourcesMatch?.[1]
          ? sourcesMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const sources = usedIds.length > 0 ? results.filter((qa) => usedIds.includes(qa.id)) : [];

        const refsMatch = fullText.match(/REFS:\s*\[([^\]]*)\]/m);
        const usedRefIds = refsMatch?.[1]
          ? refsMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const citedRefSections = usedRefIds.length > 0 ? refDocSections.filter((s) => usedRefIds.includes(s.id)) : [];

        const articlesMatch = fullText.match(/ARTICLES:\s*\[([^\]]*)\]/m);
        const usedArticleIds = articlesMatch?.[1]
          ? articlesMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const citedArticles = usedArticleIds.length > 0 ? articles.filter((a) => usedArticleIds.includes(a.id)) : [];

        const videosMatch = fullText.match(/VIDEOS:\s*\[([^\]]*)\]/m);
        const usedVideoIds = videosMatch?.[1]
          ? videosMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const citedVideos = usedVideoIds.length > 0 ? processCards.filter((pc) => usedVideoIds.includes(pc.id)) : [];

        const cleanAnswer = fullText
          .replace(/\n?SOURCES:\s*\[[^\]]*\]/gm, "")
          .replace(/\n?REFS:\s*\[[^\]]*\]/gm, "")
          .replace(/\n?ARTICLES:\s*\[[^\]]*\]/gm, "")
          .replace(/\n?VIDEOS:\s*\[[^\]]*\]/gm, "")
          .trim();

        const doneArticles = citedArticles.map((a) => ({ id: a.id, title: a.title, url: a.url, category: a.category }));
        const doneVideos = citedVideos.map((v) => ({ id: v.id, title: v.title, loom_url: v.loom_url, summary: v.summary }));

        send({
          type: "done",
          exchangeId,
          answer: cleanAnswer,
          articles: doneArticles,
          // Include the remaining context for debugging / future use but the widget UI hides them
          sources: sources.map((qa) => ({ id: qa.id, question: qa.question })),
          videos: doneVideos,
        });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...cors,
    },
  });
}
