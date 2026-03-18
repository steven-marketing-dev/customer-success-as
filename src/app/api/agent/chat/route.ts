import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb, type QAPair } from "@/lib/db/index";
import { streamChat, type ChatMessage } from "@/lib/ai/provider";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  const userId = session?.userId ?? 0;

  const { question, history = [], conversationId: incomingConvId } = await req.json() as {
    question: string;
    history: ChatMessage[];
    conversationId?: number | null;
  };

  if (!question?.trim()) {
    return new Response("Missing question", { status: 400 });
  }

  const repo = new Repository(getDb());

  // Persist: create or reuse conversation, save user message
  let conversationId = incomingConvId ?? null;
  if (userId > 0) {
    if (!conversationId) {
      const conv = repo.createConversation(userId, question.slice(0, 80));
      conversationId = conv.id;
    }
    repo.addMessage({ conversation_id: conversationId, role: "user", content: question });
  }

  // Retrieve relevant Q&A pairs using keyword scoring (not exact LIKE match)
  const results = repo.searchByKeywords(question, 8);

  // Retrieve matching KB articles (public documentation)
  const searchedArticles = repo.searchKBArticles(question, 3);

  // Retrieve matching glossary terms
  const matchedTerms = repo.getMatchingTermsForQuery(question);

  // Enrich articles with term-linked articles (terms reference specific docs)
  const seenArticleIds = new Set(searchedArticles.map((a) => a.id));
  const termLinkedArticles = matchedTerms.flatMap((t) => repo.getArticlesForTerm(t.id));
  for (const a of termLinkedArticles) {
    if (!seenArticleIds.has(a.id)) {
      searchedArticles.push(a);
      seenArticleIds.add(a.id);
    }
  }
  const articles = searchedArticles;

  // Retrieve behavioral rules (safe — table may not exist on first run before restart)
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
  } catch (e) { console.warn("[agent/chat] behavioral_cards fetch error:", e); }

  // Retrieve matching reference document sections (active docs only)
  let refDocSections: Awaited<ReturnType<typeof repo.searchRefDocSections>> = [];
  try {
    refDocSections = repo.searchRefDocSections(question, 6);
  } catch (e) { console.warn("[agent/chat] ref_docs fetch error:", e); }
  console.log(`[agent/chat] Ref doc sections found: ${refDocSections.length}`, refDocSections.map(s => s.heading));

  // Build glossary context
  const glossaryContext = matchedTerms.length > 0
    ? matchedTerms.map((t) => {
        const aliases: string[] = JSON.parse(t.aliases || "[]");
        let entry = `• ${t.name}: ${t.definition}`;
        if (aliases.length > 0) entry += ` (also: ${aliases.join(", ")})`;
        return entry;
      }).join("\n")
    : "";

  // Build articles context (truncate each to ~2000 chars)
  const articlesContext = articles.length > 0
    ? articles.map((a) => {
        const truncated = a.content.length > 2000
          ? a.content.slice(0, 2000) + "..."
          : a.content;
        return `[Article:${a.id}] ${a.title}${a.category ? ` (${a.category})` : ""}\n${truncated}`;
      }).join("\n\n")
    : "";

  // Build reference documents context (truncate each to ~2000 chars)
  const refDocsContext = refDocSections.length > 0
    ? refDocSections.map((s) => {
        const truncated = s.content.length > 2000 ? s.content.slice(0, 2000) + "..." : s.content;
        return `[REF:${s.id}] ${s.doc_title} > ${s.heading}\n${truncated}`;
      }).join("\n\n")
    : "";

  // Build context block with template + variables for pattern reasoning
  const context = results.length > 0
    ? results.map((qa) => {
        const qaCast = qa as QAPair & { category_name?: string; resolution_steps?: string; question_variables?: string };

        let entry =
          `[ID:${qa.id}] Category: ${qa.category_name ?? "Uncategorized"}\n` +
          `Q: ${qa.question}`;

        // Include template and variables so the model can reason about patterns
        if (qaCast.question_template && qaCast.question_template !== qa.question) {
          entry += `\nPattern: ${qaCast.question_template}`;
        }
        if (qaCast.question_variables) {
          try {
            const vars = JSON.parse(qaCast.question_variables);
            if (Object.keys(vars).length > 0) {
              entry += `\nVariables: ${JSON.stringify(vars)}`;
            }
          } catch { /* ignore */ }
        }

        entry += `\nA: ${qa.answer ?? qa.summary ?? "(no answer recorded)"}`;
        entry += `\nResolved: ${qa.resolved ? "Yes" : "No"}`;

        // Include resolution steps when available
        const steps: string[] = (() => {
          try { return JSON.parse(qaCast.resolution_steps ?? "[]"); }
          catch { return []; }
        })();
        if (steps.length > 0) {
          entry += `\nResolution Steps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
        }

        return entry;
      }).join("\n\n")
    : "No relevant entries found in the knowledge base.";

  const system = `You are a customer support assistant for this company. Your job is to answer questions based ONLY on the knowledge base entries and documentation provided below.

IMPORTANT — Pattern-based reasoning:
- Some entries include a "Pattern" field (e.g., "How do I schedule a meeting for {{service_name}}?") and "Variables" (e.g., {"service_name": "Service X"}).
- The Pattern shows the generalized form of the question. The same solution can apply to different variable values.
- If a user asks about "Service Y" but you only have a matching pattern for "Service X", the answer/process is likely the same — adapt it to the user's context.
- Think about the underlying process or workflow, not just the specific entity mentioned.

Rules:
- Answer directly and concisely based on the provided knowledge base entries and documentation
- Use the glossary to understand product-specific terminology
- Reference official documentation (Articles) for how-to content and feature explanations
- Reference support Q&A entries for real customer interactions and resolutions
- IMPORTANT: Reference documents (marked [REF:N]) contain authoritative training materials and product manuals. When they contain information relevant to the question, you MUST use that information and cite the section ID. They are the most reliable source for assessment methodology, trait definitions, scoring interpretation, and validation procedures.
- When the exact topic isn't in the KB but a similar pattern exists, adapt the answer and note that you're applying a similar case
- If the question truly cannot be answered from the provided entries, say so clearly — do not guess or invent information
- If the answer is partial, say what you know and note the limitation
- Do not reference external information
- CITATION RULES: At the very end of your response, output these three lines exactly. You MUST cite every source you drew information from — do not leave a citation list empty if you used that source type:
  SOURCES:[id1,id2,...] (IDs of Q&A entries [ID:N] you used, or SOURCES:[] if none)
  REFS:[id1,id2,...] (IDs of reference document sections [REF:N] you used, or REFS:[] if none)
  ARTICLES:[id1,id2,...] (IDs of articles [Article:N] you used, or ARTICLES:[] if none)
${(() => {
  const rules: string[] = [];
  for (const r of globalRules) {
    rules.push(`[GLOBAL${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);
  }
  for (const r of categoryRules) {
    rules.push(`[CATEGORY${r.type !== "general" ? ` / ${r.type.toUpperCase()}` : ""}] ${r.title}: ${r.instruction}`);
  }
  return rules.length > 0 ? `
--- BEHAVIORAL RULES ---
Follow these rules when formulating your response. Category rules apply only when the question relates to that category. KNOWLEDGE means the user wants understanding. SOLUTION means the user wants actionable steps.
${rules.join("\n")}
--- END BEHAVIORAL RULES ---` : "";
})()}
${glossaryContext ? `
--- GLOSSARY ---
${glossaryContext}
--- END GLOSSARY ---` : ""}
${refDocsContext ? `
--- REFERENCE DOCUMENTS (training materials & product manuals — use these for trait definitions, assessment methodology, scoring, and validation) ---
${refDocsContext}
--- END REFERENCE DOCUMENTS ---` : ""}
${articlesContext ? `
--- DOCUMENTATION (public KB articles) ---
${articlesContext}
--- END DOCUMENTATION ---` : ""}

--- SUPPORT Q&A (past customer tickets) ---
${context}
--- END SUPPORT Q&A ---`;

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

        // Parse SOURCES:[...] and REFS:[...] from the end of the response
        const sourcesMatch = fullText.match(/SOURCES:\[([^\]]*)\]/m);
        const usedIds = sourcesMatch?.[1]
          ? sourcesMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];

        const sources = usedIds.length > 0
          ? results.filter((qa) => usedIds.includes(qa.id))
          : [];

        // Parse REFS:[id,...] from the response
        const refsMatch = fullText.match(/REFS:\[([^\]]*)\]/m);
        const usedRefIds = refsMatch?.[1]
          ? refsMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const citedRefSections = usedRefIds.length > 0
          ? refDocSections.filter((s) => usedRefIds.includes(s.id))
          : [];

        // Parse ARTICLES:[id,...] from the response
        const articlesMatch = fullText.match(/ARTICLES:\[([^\]]*)\]/m);
        const usedArticleIds = articlesMatch?.[1]
          ? articlesMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];
        const citedArticles = usedArticleIds.length > 0
          ? articles.filter((a) => usedArticleIds.includes(a.id))
          : [];

        // Strip SOURCES, REFS, and ARTICLES lines from the answer
        const cleanAnswer = fullText
          .replace(/\n?SOURCES:\[[^\]]*\]/m, "")
          .replace(/\n?REFS:\[[^\]]*\]/m, "")
          .replace(/\n?ARTICLES:\[[^\]]*\]/m, "")
          .trim();

        // Extract relevant excerpts from cited content by finding the best-matching paragraph
        function extractExcerpt(content: string, answer: string): string {
          const paragraphs = content
            .split(/\n\n+|\n(?=[A-Z•\-\d])/)
            .map((p) => p.trim())
            .filter((p) => p.length > 30 && p.length < 500);
          if (paragraphs.length === 0) return content.slice(0, 200).trim();

          const answerWords = new Set(answer.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
          let best = paragraphs[0];
          let bestScore = 0;
          for (const p of paragraphs) {
            const words = p.toLowerCase().split(/\W+/);
            const score = words.filter((w) => answerWords.has(w)).length;
            if (score > bestScore) {
              bestScore = score;
              best = p;
            }
          }
          return best;
        }

        const doneArticles = citedArticles.map((a) => ({ id: a.id, title: a.title, url: a.url, category: a.category, excerpt: extractExcerpt(a.content, cleanAnswer) }));
        const doneTerms = matchedTerms.map((t) => ({ id: t.id, name: t.name, definition: t.definition }));
        const doneRefSections = citedRefSections.map((s) => ({ id: s.id, doc_title: s.doc_title, heading: s.heading, excerpt: extractExcerpt(s.content, cleanAnswer), content: s.content }));

        // Persist assistant message
        let messageId: number | null = null;
        if (userId > 0 && conversationId) {
          const sourcesJson = JSON.stringify({ sources, articles: doneArticles, terms: doneTerms, refSections: doneRefSections });
          const msg = repo.addMessage({ conversation_id: conversationId, role: "assistant", content: cleanAnswer, sources_json: sourcesJson });
          messageId = msg.id;
        }

        send({
          type: "done",
          answer: cleanAnswer,
          sources,
          articles: doneArticles,
          terms: doneTerms,
          refSections: doneRefSections,
          conversationId,
          messageId,
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
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
