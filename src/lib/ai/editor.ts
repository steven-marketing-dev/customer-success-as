import { generateJSON } from "./provider";

export interface EditResult {
  question?: string;
  answer?: string | null;
  resolution_steps?: string[];
  summary?: string;
  resolved?: boolean;
}

const SYSTEM = `You are a knowledge base editor for a customer support system. You update Q&A cards based on user instructions while following strict formatting rules. Respond ONLY with valid JSON.`;

export async function applyAiEdit(
  current: {
    question: string;
    answer: string | null;
    resolution_steps: string[];
    summary: string | null;
    resolved: boolean;
  },
  instruction: string
): Promise<EditResult> {
  const prompt = `Here is the current Q&A card:

Question: ${current.question}
Answer: ${current.answer ?? "(none)"}
Resolution Steps: ${current.resolution_steps.length > 0 ? current.resolution_steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none)"}
Summary: ${current.summary ?? "(none)"}
Resolved: ${current.resolved ? "Yes" : "No"}

User instruction: "${instruction}"

Apply the instruction and return a JSON object with ONLY the fields that changed:
{
  "question": "updated question (only if changed)",
  "answer": "updated answer (only if changed)",
  "resolution_steps": ["step 1", "step 2"] (only if changed),
  "summary": "updated summary (only if changed)",
  "resolved": true/false (only if changed)
}

FORMATTING RULES — you MUST follow these when writing/updating any field:
- question: Clear and concise. The customer's core question in one sentence.
- answer: The complete resolution narrative with all technical details, exact values, settings, and steps used. Write it as a structured explanation — not a raw copy-paste of a conversation. Rewrite any pasted content into this format.
- resolution_steps: An ordered list of the concrete actions taken to resolve the issue. Each step must be specific and actionable — include exact configurations, commands, URLs, or settings used. Do NOT use vague steps like "resolved the issue" or "followed up with client". If the user pastes raw text or conversation, extract the actual actionable steps from it.
- summary: 1-2 sentences summarizing what the issue was and how it was resolved.
- resolved: Set to true only if the answer contains a complete resolution.

IMPORTANT:
- If the user pastes a raw response or conversation, DO NOT just copy it into the answer field. Instead, analyze it and extract the structured information into the appropriate fields (answer, resolution_steps, summary, resolved).
- Preserve existing information — merge new info with what's already there, don't replace unless the user explicitly asks to.
- Only include fields that actually changed in the output.
- For resolution_steps, always return the complete list (existing + new steps merged).
- Return ONLY the JSON.`;

  const raw = await generateJSON(SYSTEM, prompt, { smart: true });
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  const data = JSON.parse(cleaned);

  const result: EditResult = {};
  if (data.question !== undefined) result.question = String(data.question);
  if (data.answer !== undefined) result.answer = data.answer;
  if (data.resolution_steps !== undefined && Array.isArray(data.resolution_steps)) {
    result.resolution_steps = data.resolution_steps.map(String);
  }
  if (data.summary !== undefined) result.summary = String(data.summary);
  if (data.resolved !== undefined) result.resolved = Boolean(data.resolved);

  return result;
}
