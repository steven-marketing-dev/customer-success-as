import { generateJSONMultimodal } from "./provider";

export interface ExtractedQA {
  question: string;
  question_template: string;
  question_variables: Array<{ name: string; value: string }>;
  answer: string | null;
  resolution_steps: string[];
  resolved: boolean;
  channel: string;
  summary: string;
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
  "summary": "Summary in 1-2 sentences"
}

Rules:
- question_template: use [UPPERCASE] for each variable (PRODUCT, VERSION, COUNTRY, PLAN, ERROR, etc.)
- question_variables: only variables with a concrete identifiable value
- answer: the complete resolution narrative, include all technical details, exact values, settings, and steps. null if unresolved.
- resolution_steps: ordered list of the concrete actions taken by the support agent to resolve the issue. Be specific and actionable — include exact configurations, commands, URLs, or settings used. Empty array if unresolved.
- channel: email | chat | phone | web_form | unknown
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
    };
  }
}
