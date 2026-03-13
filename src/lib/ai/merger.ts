import { generateJSON } from "./provider";
import type { QAPair } from "../db/index";
import type { ExtractedQA } from "./extractor";

export interface MergeResult {
  action: "merge" | "create";
  merge_target_id?: number;
  merged?: {
    question: string;
    question_template: string;
    question_variables: Array<{ name: string; value: string }>;
    answer: string | null;
    resolution_steps: string[];
    summary: string;
    resolved: boolean;
  };
}

const SYSTEM = `You are a knowledge base deduplication expert. You compare a newly extracted Q&A with existing Q&A entries from the same ticket to decide whether to merge or create a new entry. Respond ONLY with valid JSON.`;

export async function mergeOrCreate(
  newQA: ExtractedQA,
  existingQAs: QAPair[]
): Promise<MergeResult> {
  const existingText = existingQAs
    .map((qa) => {
      const steps: string[] = (() => {
        try { return JSON.parse(qa.resolution_steps ?? "[]"); }
        catch { return []; }
      })();
      return `[ID:${qa.id}]
Question: ${qa.question}
Template: ${qa.question_template ?? "(none)"}
Answer: ${qa.answer ?? "(none)"}
Steps: ${steps.length > 0 ? steps.map((s, i) => `${i + 1}. ${s}`).join("; ") : "(none)"}
Resolved: ${qa.resolved ? "Yes" : "No"}`;
    })
    .join("\n\n");

  const newSteps = newQA.resolution_steps.length > 0
    ? newQA.resolution_steps.map((s, i) => `${i + 1}. ${s}`).join("; ")
    : "(none)";

  const prompt = `Compare this newly extracted Q&A with the existing entries from the same ticket.

=== NEW EXTRACTION ===
Question: ${newQA.question}
Template: ${newQA.question_template}
Answer: ${newQA.answer ?? "(none)"}
Steps: ${newSteps}
Resolved: ${newQA.resolved ? "Yes" : "No"}
Summary: ${newQA.summary}

=== EXISTING ENTRIES ===
${existingText}

Decide:
1. If the new extraction is about the SAME question/issue as an existing entry → MERGE
   - Combine information: keep the most complete answer, add any new resolution steps (avoid duplicates), update resolved status
   - The merge should be ADDITIVE — never lose existing information
2. If it's a genuinely DIFFERENT question → CREATE a new entry

Return JSON:
For merge: {"action": "merge", "merge_target_id": <id of existing entry to update>, "merged": {"question": "...", "question_template": "...", "question_variables": [...], "answer": "...", "resolution_steps": [...], "summary": "...", "resolved": true/false}}
For create: {"action": "create"}

Return ONLY the JSON.`;

  const raw = await generateJSON(SYSTEM, prompt);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  const data = JSON.parse(cleaned);

  if (data.action === "merge" && data.merge_target_id && data.merged) {
    // Validate merge_target_id is one of the existing QAs
    const validIds = new Set(existingQAs.map((q) => q.id));
    if (!validIds.has(data.merge_target_id)) {
      return { action: "create" };
    }

    return {
      action: "merge",
      merge_target_id: data.merge_target_id,
      merged: {
        question: String(data.merged.question ?? newQA.question),
        question_template: String(data.merged.question_template ?? newQA.question_template),
        question_variables: Array.isArray(data.merged.question_variables)
          ? data.merged.question_variables
          : newQA.question_variables,
        answer: data.merged.answer ?? null,
        resolution_steps: Array.isArray(data.merged.resolution_steps)
          ? data.merged.resolution_steps.map(String).filter(Boolean)
          : [],
        summary: String(data.merged.summary ?? newQA.summary),
        resolved: Boolean(data.merged.resolved),
      },
    };
  }

  return { action: "create" };
}
