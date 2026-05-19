import { generateJSON, generateJSONMultimodal } from "./provider";
import type { RootCause } from "../db/index";

const ROOT_CAUSES: readonly RootCause[] = [
  "ui_friction",
  "onboarding_gap",
  "platform_bug",
  "feature_request",
  "how_to",
  "billing",
  "other",
] as const;

function coerceRootCause(raw: unknown): RootCause {
  const v = String(raw ?? "").trim().toLowerCase();
  return (ROOT_CAUSES as readonly string[]).includes(v) ? (v as RootCause) : "other";
}

export interface ExtractedQA {
  question: string;
  question_template: string;
  question_variables: Array<{ name: string; value: string }>;
  answer: string | null;
  resolution_steps: string[];
  resolved: boolean;
  channel: string;
  summary: string;
  root_cause: RootCause;
}

const SYSTEM = `You are an expert Customer Success analyst.
Analyze support tickets and extract structured information.
Respond ONLY with valid JSON and nothing else.`;

const buildPrompt = (subject: string, content: string, conversation: string) => {
  let text = "";
  if (subject) text += `Subject: ${subject}\n`;
  if (content) text += `\nContent:\n${content}`;
  if (conversation) text += `\n\nConversation:\n${conversation}`;

  if (text.length > 12000) text = text.slice(0, 12000) + "\n...[truncated]";

  return `Analyze this support ticket:

=== TICKET ===
${text}
=== END ===

Return this exact JSON:
{
  "question": "The customer's core question, clear and concise",
  "question_template": "Same question with specific values replaced: Cannot access [PRODUCT] on [DEVICE]",
  "question_variables": [{"name": "PRODUCT", "value": "Acme App"}, {"name": "DEVICE", "value": "iPhone"}],
  "answer": "Full resolution given to the customer, including all details, configurations, commands or settings used. null if not resolved.",
  "resolution_steps": [
    "Step 1: What was diagnosed or identified first",
    "Step 2: Specific action taken (exact setting, command, config change, etc.)",
    "Step 3: Verification or follow-up done"
  ],
  "resolved": true,
  "channel": "email",
  "summary": "Summary in 1-2 sentences",
  "root_cause": "ui_friction"
}

Rules:
- question_template: use [UPPERCASE] for each variable (PRODUCT, VERSION, COUNTRY, PLAN, ERROR, etc.)
- question_variables: only variables with a concrete identifiable value
- answer: the complete resolution narrative, include all technical details, exact values, settings, and steps. null if unresolved.
- resolution_steps: ordered list of the concrete actions taken by the support agent to resolve the issue. Be specific and actionable — include exact configurations, commands, URLs, or settings used. Empty array if unresolved.
- channel: email | chat | phone | web_form | unknown
- root_cause: pick exactly ONE of these seven values:
    - "ui_friction": the user struggles with an existing UI flow (couldn't find a button, confusing layout, unclear labels)
    - "onboarding_gap": the user doesn't understand how the platform fundamentally works (missing mental model, not a specific UI issue)
    - "platform_bug": something is broken or behaving unexpectedly (errors, crashes, data wrong)
    - "feature_request": the user wants something the product doesn't currently do
    - "how_to": a straightforward "how do I do X?" question that documentation could answer
    - "billing": invoicing, plan changes, payments, refunds
    - "other": doesn't fit any of the above
- Return ONLY the JSON`;
};

export class QAExtractor {
  async extract(
    subject: string,
    content: string,
    conversation = "",
    images: Array<{ mimeType: string; data: string }> = []
  ): Promise<ExtractedQA> {
    const prompt = buildPrompt(subject, content, conversation);
    const raw = await generateJSONMultimodal(SYSTEM, prompt, images);
    return this.parse(raw);
  }

  /** Lightweight backfill helper — classifies root_cause for an existing qa_pair.
   *  Uses the cheap Haiku tier (default for generateJSON without smart=true). */
  async classifyRootCause(qa: { question: string; answer: string | null; summary: string | null }): Promise<RootCause> {
    const prompt = `Classify the following support Q&A by its root cause.

Question: ${qa.question}
Answer: ${qa.answer ?? "(unresolved)"}
Summary: ${qa.summary ?? ""}

Pick exactly ONE value from this list and return JSON of the form {"root_cause": "..."}:
- "ui_friction": user struggles with an existing UI flow (couldn't find a button, confusing layout)
- "onboarding_gap": user doesn't understand how the platform fundamentally works
- "platform_bug": something is broken or behaving unexpectedly
- "feature_request": user wants something the product doesn't do
- "how_to": straightforward "how do I do X?" question, doc-answerable
- "billing": invoicing, plan, payment
- "other": fallback when nothing else fits

Return ONLY the JSON.`;
    try {
      const raw = await generateJSON(SYSTEM, prompt);
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
      const data = JSON.parse(cleaned);
      return coerceRootCause(data.root_cause);
    } catch {
      return "other";
    }
  }

  private parse(raw: string): ExtractedQA {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "");

    const data = JSON.parse(cleaned);

    return {
      question: String(data.question ?? "").trim(),
      question_template: String(data.question_template ?? data.question ?? "").trim(),
      question_variables: Array.isArray(data.question_variables)
        ? data.question_variables
        : [],
      answer: data.answer ?? null,
      resolution_steps: Array.isArray(data.resolution_steps)
        ? data.resolution_steps.map(String).filter(Boolean)
        : [],
      resolved: Boolean(data.resolved),
      channel: String(data.channel ?? "unknown"),
      summary: String(data.summary ?? "").trim(),
      root_cause: coerceRootCause(data.root_cause),
    };
  }
}
