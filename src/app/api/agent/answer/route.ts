import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb, type QAPair } from "@/lib/db/index";
import { streamChat } from "@/lib/ai/provider";
import { sanitizeCalendlyLinks } from "@/lib/calendly";

export const maxDuration = 60;

/**
 * Machine-to-machine endpoint for n8n (or any backend caller).
 *
 * Unlike /api/agent/chat this:
 *   - authenticates with a static API key header (x-api-key) instead of a session cookie
 *   - returns a single JSON object instead of an SSE stream
 *
 * The path is whitelisted in middleware.ts so the cookie check is skipped; auth
 * is enforced here against N8N_API_KEY.
 *
 * Request:  { "question": string }
 * Response: { answer, articles, sources, refSections, videos, kb_gap }
 */
export async function POST(req: NextRequest) {
  const expected = process.env.N8N_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "N8N_API_KEY not configured" }, { status: 500 });
  }
  if (req.headers.get("x-api-key") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  const repo = new Repository(getDb());

  // --- Retrieval (mirrors /api/agent/chat) ---
  const results = repo.searchByKeywords(question, 8);

  const searchedArticles = repo.searchKBArticles(question, 3);
  const matchedTerms = repo.getMatchingTermsForQuery(question);
  const seenArticleIds = new Set(searchedArticles.map((a) => a.id));
  for (const a of matchedTerms.flatMap((t) => repo.getArticlesForTerm(t.id))) {
    if (!seenArticleIds.has(a.id)) {
      searchedArticles.push(a);
      seenArticleIds.add(a.id);
    }
  }
  const articles = searchedArticles;

  let globalRules: Awaited<ReturnType<typeof repo.getGlobalBehavioralCards>> = [];
  let categoryRules: typeof globalRules = [];
  try {
    globalRules = repo.getGlobalBehavioralCards();
    const matchedCategoryIds = [...new Set(
      results
        .map((qa) => (qa as unknown as Record<string, unknown>).category_id as number | undefined)
        .filter((id): id is number => id != null)
    )];
    categoryRules = matchedCategoryIds.length > 0
      ? repo.getBehavioralCardsForCategories(matchedCategoryIds)
      : [];
  } catch (e) { console.warn("[agent/answer] behavioral_cards fetch error:", e); }

  let refDocSections: Awaited<ReturnType<typeof repo.searchRefDocSections>> = [];
  try {
    refDocSections = repo.searchRefDocSections(question, 6);
  } catch (e) { console.warn("[agent/answer] ref_docs fetch error:", e); }

  let processCards: Awaited<ReturnType<typeof repo.searchProcessCards>> = [];
  try {
    processCards = repo.searchProcessCards(question, 3);
  } catch (e) { console.warn("[agent/answer] process_cards fetch error:", e); }

  // --- Context blocks ---
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
        const qaCast = qa as QAPair & { category_name?: string; resolution_steps?: string; question_variables?: string; question_template?: string };
        let entry = `[ID:${qa.id}] Category: ${qaCast.category_name ?? "Uncategorized"}\nQ: ${qa.question}`;
        if (qaCast.question_template && qaCast.question_template !== qa.question) {
          entry += `\nPattern: ${qaCast.question_template}`;
        }
        if (qaCast.question_variables) {
          try {
            const vars = JSON.parse(qaCast.question_variables);
            if (Object.keys(vars).length > 0) entry += `\nVariables: ${JSON.stringify(vars)}`;
          } catch { /* */ }
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

  const rules: string[] = [];
  for (const r of globalRules) rules.push(`[GLOBAL${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);
  for (const r of categoryRules) rules.push(`[CATEGORY${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);

  // System prompt: KB-grounded substance only. No sign-off / Calendly / email
  // formatting — n8n's "1.16 Generate Response" node owns the email shape.
  const system = `You are a customer support knowledge assistant. Answer the question using ONLY the knowledge base entries and documentation provided below. Your answer will be used as factual context by a downstream system that formats the final customer email, so DO NOT add greetings, sign-offs, or scheduling links — just the substance.

Rules:
- Answer directly and concisely from the provided entries and documentation.
- Use the glossary to understand product-specific terminology.
- Prefer reference documents (marked [REF:N]) for assessment methodology, trait definitions, scoring, and validation — they are authoritative.
- When the exact topic isn't in the KB but a similar pattern exists, adapt the answer and note you are applying a similar case.
- If the question cannot be answered from the provided entries, say so clearly — do not guess. (The downstream system will route these to a human.)
- At the very END of your response, output these citation lines exactly:
  SOURCES:[id1,id2,...] (IDs of Q&A entries [ID:N] you used, or SOURCES:[] if none)
  REFS:[id1,id2,...] (IDs of reference sections [REF:N] you used, or REFS:[] if none)
  ARTICLES:[id1,id2,...] (IDs of articles [Article:N] you referenced, or ARTICLES:[] if none)
  VIDEOS:[id1,id2,...] (IDs of video walkthroughs [VIDEO:N] you used, or VIDEOS:[] if none)
${rules.length > 0 ? `\n--- BEHAVIORAL RULES ---\n${rules.join("\n")}\n--- END BEHAVIORAL RULES ---` : ""}${glossaryContext ? `\n--- GLOSSARY ---\n${glossaryContext}\n--- END GLOSSARY ---` : ""}${refDocsContext ? `\n--- REFERENCE DOCUMENTS ---\n${refDocsContext}\n--- END REFERENCE DOCUMENTS ---` : ""}${articlesContext ? `\n--- DOCUMENTATION (${articles.length} public KB article${articles.length !== 1 ? "s" : ""}) ---\n${articlesContext}\n--- END DOCUMENTATION ---` : ""}${processCardsContext ? `\n--- VIDEO WALKTHROUGHS ---\n${processCardsContext}\n--- END VIDEO WALKTHROUGHS ---` : ""}

--- SUPPORT Q&A (past customer tickets) ---
${context}
--- END SUPPORT Q&A ---`;

  let fullText = "";
  try {
    for await (const text of streamChat(system, [], question)) fullText += text;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  // Parse citation lines
  const parseIds = (label: string): number[] => {
    const m = fullText.match(new RegExp(`${label}:\\s*\\[([^\\]]*)\\]`, "m"));
    return m?.[1] ? m[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean) : [];
  };
  const usedIds = parseIds("SOURCES");
  const usedRefIds = parseIds("REFS");
  const usedArticleIds = parseIds("ARTICLES");
  const usedVideoIds = parseIds("VIDEOS");

  const cleanAnswer = sanitizeCalendlyLinks(
    fullText
      .replace(/\n?SOURCES:\s*\[[^\]]*\]/gm, "")
      .replace(/\n?REFS:\s*\[[^\]]*\]/gm, "")
      .replace(/\n?ARTICLES:\s*\[[^\]]*\]/gm, "")
      .replace(/\n?VIDEOS:\s*\[[^\]]*\]/gm, "")
      .trim(),
    null
  );

  const citedArticles = articles
    .filter((a) => usedArticleIds.includes(a.id))
    .map((a) => ({ id: a.id, title: a.title, url: a.url, category: a.category }));

  // No KB hit at all, or the model said it couldn't answer → flag for human routing.
  const kb_gap = results.length === 0 && articles.length === 0 && refDocSections.length === 0;

  return NextResponse.json({
    answer: cleanAnswer,
    articles: citedArticles,
    sources: results.filter((qa) => usedIds.includes(qa.id)).map((qa) => ({ id: qa.id, question: qa.question })),
    refSections: refDocSections.filter((s) => usedRefIds.includes(s.id)).map((s) => ({ id: s.id, doc_title: s.doc_title, heading: s.heading })),
    videos: processCards.filter((pc) => usedVideoIds.includes(pc.id)).map((pc) => ({ id: pc.id, title: pc.title, loom_url: pc.loom_url })),
    kb_gap,
  });
}
