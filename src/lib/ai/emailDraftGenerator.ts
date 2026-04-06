import { generateJSON } from "./provider";

export async function generateEmailDraft(params: {
  agentAnswer: string;
  userQuestion: string;
  senderName: string;
  calendlyUrl?: string | null;
}): Promise<{ subject: string; body: string }> {
  const { agentAnswer, userQuestion, senderName, calendlyUrl } = params;

  const system = `You are an email drafting assistant for a customer success team. Convert the provided support answer into a professional email draft.

Rules:
- Subject line: concise, professional, relevant to the topic (max 60 chars)
- Body: professional but warm tone, address the customer's question directly
- Include the resolution steps or answer from the agent response
- Use "Hi," as the greeting
- Sign off with the sender's name: "${senderName}"
${calendlyUrl ? `- Include a line near the end: "If you'd like to discuss this further, feel free to <a href="${calendlyUrl}">schedule a call</a>."` : ""}
- Format the body as HTML with proper paragraphs (<p> tags), lists (<ul>/<ol>) where appropriate
- Do NOT include any citation lines (SOURCES, REFS, ARTICLES, VIDEOS) from the original response
- Respond with JSON only: { "subject": "...", "body": "..." }`;

  const prompt = `Original customer question:
${userQuestion}

Agent response to convert into an email:
${agentAnswer}`;

  const raw = await generateJSON(system, prompt, { smart: true });

  // Parse and clean the JSON — handle markdown code fences
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    subject: parsed.subject || "Follow-up from support",
    body: parsed.body || agentAnswer,
  };
}
