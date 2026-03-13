import { generateJSON } from "./provider";

export interface CorrectionProposal {
  qa_id: number;
  changes: {
    question?: string;
    answer?: string | null;
    resolution_steps?: string[];
    summary?: string;
    resolved?: boolean;
  };
  reasoning: string;
}

export interface BehavioralSuggestion {
  scope: "global" | "category";
  category_name?: string;
  type: "knowledge" | "solution" | "general";
  title: string;
  instruction: string;
}

interface SourceQA {
  id: number;
  question: string;
  answer: string | null;
  resolution_steps: string[];
  summary: string | null;
  resolved: boolean;
  category_name?: string;
}

const SYSTEM = `You are a knowledge base correction assistant. You analyze user feedback about an AI agent's response and determine what changes are needed to the source Q&A cards that produced the response. Respond ONLY with valid JSON.`;

/**
 * Given a user's feedback about an agent response, generate proposed corrections
 * to the source QA cards and optionally suggest a behavioral card.
 */
export async function generateCorrectionPreview(
  agentQuestion: string,
  agentAnswer: string,
  userFeedback: string,
  sourceQAs: SourceQA[],
): Promise<{
  corrections: CorrectionProposal[];
  behavioral_suggestion: BehavioralSuggestion | null;
}> {
  const sourceCards = sourceQAs
    .map(
      (qa) =>
        `[ID:${qa.id}] Category: ${qa.category_name ?? "Uncategorized"}
Q: ${qa.question}
A: ${qa.answer ?? "(none)"}
Resolution Steps: ${qa.resolution_steps.length > 0 ? qa.resolution_steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none)"}
Summary: ${qa.summary ?? "(none)"}
Resolved: ${qa.resolved ? "Yes" : "No"}`,
    )
    .join("\n\n---\n\n");

  const prompt = `The AI agent was asked a question and gave a response. The user is reporting a problem with the response.

USER'S QUESTION: ${agentQuestion}

AGENT'S RESPONSE: ${agentAnswer}

USER'S FEEDBACK: ${userFeedback}

SOURCE Q&A CARDS (these produced the response):
${sourceCards}

Based on the user's feedback, determine:
1. Which source Q&A cards need updating and what specific fields should change
2. Whether the feedback is about content (wrong info) or structure (how the answer is formatted/presented)

Return JSON:
{
  "corrections": [
    {
      "qa_id": <number>,
      "changes": {
        "question": "updated question (only if it needs changing)",
        "answer": "updated answer (only if it needs changing)",
        "resolution_steps": ["step 1", "step 2"] (only if they need changing),
        "summary": "updated summary (only if it needs changing)",
        "resolved": true/false (only if it needs changing)
      },
      "reasoning": "brief explanation of why this card needs this change"
    }
  ],
  "behavioral_suggestion": null | {
    "scope": "global" | "category",
    "category_name": "category name if scope is category",
    "type": "knowledge" | "solution" | "general",
    "title": "short rule name (3-6 words)",
    "instruction": "the behavioral rule the agent should follow"
  }
}

FORMATTING RULES for Q&A card fields:
- question: Clear and concise. The customer's core question in one sentence.
- answer: Structured explanation with technical details, exact values, settings. Not raw conversation paste.
- resolution_steps: Ordered list of concrete, actionable steps with exact configs/commands/URLs.
- summary: 1-2 sentences summarizing issue + resolution.
- resolved: true only if the answer contains a complete resolution.

IMPORTANT:
- Only include fields that actually need changing in each correction's "changes" object
- If the feedback is purely structural (e.g., "too verbose", "needs step-by-step format", "should be more concise"), set behavioral_suggestion instead of or in addition to corrections
- behavioral_suggestion.type should be "knowledge" if the user wants explanations/understanding, "solution" if they want actionable fixes, or "general" for formatting/style rules
- For resolution_steps, always return the complete list (existing + changes merged)
- If no Q&A cards need content changes, return "corrections": []
- Return ONLY the JSON`;

  const raw = await generateJSON(SYSTEM, prompt, { smart: true });
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    const data = JSON.parse(cleaned);

    const corrections: CorrectionProposal[] = Array.isArray(data.corrections)
      ? data.corrections
          .filter(
            (c: { qa_id?: number; changes?: object }) =>
              c.qa_id && c.changes && Object.keys(c.changes).length > 0,
          )
          .map((c: { qa_id: number; changes: Record<string, unknown>; reasoning?: string }) => ({
            qa_id: c.qa_id,
            changes: {
              ...(c.changes.question !== undefined ? { question: String(c.changes.question) } : {}),
              ...(c.changes.answer !== undefined ? { answer: c.changes.answer as string | null } : {}),
              ...(c.changes.resolution_steps !== undefined && Array.isArray(c.changes.resolution_steps)
                ? { resolution_steps: (c.changes.resolution_steps as unknown[]).map(String) }
                : {}),
              ...(c.changes.summary !== undefined ? { summary: String(c.changes.summary) } : {}),
              ...(c.changes.resolved !== undefined ? { resolved: Boolean(c.changes.resolved) } : {}),
            },
            reasoning: c.reasoning ?? "",
          }))
      : [];

    const bs = data.behavioral_suggestion;
    const behavioral_suggestion: BehavioralSuggestion | null =
      bs && bs.title && bs.instruction
        ? {
            scope: bs.scope === "category" ? "category" : "global",
            category_name: bs.category_name ?? undefined,
            type: ["knowledge", "solution", "general"].includes(bs.type) ? bs.type : "general",
            title: String(bs.title),
            instruction: String(bs.instruction),
          }
        : null;

    return { corrections, behavioral_suggestion };
  } catch {
    return { corrections: [], behavioral_suggestion: null };
  }
}
