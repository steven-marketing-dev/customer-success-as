import { NextRequest } from "next/server";
import { Repository } from "@/lib/db/repository";
import { getDb, type QAPair } from "@/lib/db/index";
import { streamChat, type ChatMessage } from "@/lib/ai/provider";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { question, history = [] } = await req.json() as {
    question: string;
    history: ChatMessage[];
  };

  if (!question?.trim()) {
    return new Response("Missing question", { status: 400 });
  }

  const repo = new Repository(getDb());

  // Retrieve relevant Q&A pairs using keyword scoring (not exact LIKE match)
  const results = repo.searchByKeywords(question, 10);

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
    refDocSections = repo.searchRefDocSections(question, 5);
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
        return `[Article] ${a.title}${a.category ? ` (${a.category})` : ""}\n${truncated}`;
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
- When the exact topic isn't in the KB but a similar pattern exists, adapt the answer and note that you're applying a similar case
- If the question truly cannot be answered from the provided entries, say so clearly — do not guess or invent information
- If the answer is partial, say what you know and note the limitation
- Do not reference external information
- Reference documents contain training materials and product manuals — use them for assessment methodology, trait definitions, scoring interpretation, and validation procedures
- At the very end of your response, output these two lines:
  SOURCES:[id1,id2,...] (IDs of Q&A entries you used, or SOURCES:[] if none)
  REFS:[id1,id2,...] (IDs of reference document sections you used, or REFS:[] if none)
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
${articlesContext ? `
--- DOCUMENTATION ---
${articlesContext}
--- END DOCUMENTATION ---` : ""}
${refDocsContext ? `
--- REFERENCE DOCUMENTS ---
${refDocsContext}
--- END REFERENCE DOCUMENTS ---` : ""}

--- SUPPORT Q&A ---
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

        // Parse REFS:[...] if the agent included them (optional)
        const refsMatch = fullText.match(/REFS:\[([^\]]*)\]/m);
        const usedRefIds = refsMatch?.[1]
          ? refsMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
          : [];

        // If the agent cited specific refs, use those; otherwise show all searched sections
        const refSectionsToSend = usedRefIds.length > 0
          ? refDocSections.filter((s) => usedRefIds.includes(s.id))
          : refDocSections;

        // Strip SOURCES and REFS lines from the answer
        const cleanAnswer = fullText
          .replace(/\n?SOURCES:\[[^\]]*\]/m, "")
          .replace(/\n?REFS:\[[^\]]*\]/m, "")
          .trim();

        send({
          type: "done",
          answer: cleanAnswer,
          sources,
          articles: articles.map((a) => ({ id: a.id, title: a.title, url: a.url, category: a.category })),
          terms: matchedTerms.map((t) => ({ id: t.id, name: t.name, definition: t.definition })),
          refSections: refSectionsToSend.map((s) => ({ id: s.id, doc_title: s.doc_title, heading: s.heading })),
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
