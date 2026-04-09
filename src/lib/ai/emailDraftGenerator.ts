import { generateJSON } from "./provider";

export async function generateEmailDraft(params: {
  agentAnswer: string;
  userQuestion: string;
  senderName: string;
  calendlyUrl?: string | null;
  articles?: Array<{ title: string; url: string }>;
}): Promise<{ subject: string; body: string }> {
  const { agentAnswer, userQuestion, calendlyUrl, articles } = params;

  const hasArticles = articles && articles.length > 0;

  const system = `You are an email drafting assistant for a customer success team. Convert the provided support answer into a professional email draft.

Rules:
- Subject line: concise, professional, relevant to the topic (max 60 chars)
- Body: professional but warm tone, address the customer's question directly
- Include the resolution steps or answer from the agent response
- Use "Hi," as the greeting
- Do NOT include any sign-off, signature, or sender name at the end
${calendlyUrl ? `- Include a line near the end: "If you'd like to discuss this further, feel free to <a href="${calendlyUrl}">schedule a call</a>."` : ""}
${hasArticles ? `- IMPORTANT: Include a "Helpful Resources" section at the end of the body with the provided KB articles as clickable links. Format as: <p><strong>Helpful Resources:</strong></p><ul> with <li><a href="URL">Title</a></li> for each article.` : ""}
- Format the body as HTML with proper paragraphs (<p> tags), lists (<ul>/<ol>) where appropriate
- Do NOT include any citation lines (SOURCES, REFS, ARTICLES, VIDEOS) from the original response
- Respond with JSON only: { "subject": "...", "body": "..." }`;

  const prompt = `Original customer question:
${userQuestion}

Agent response to convert into an email:
${agentAnswer}
${hasArticles ? `\nKB Articles to include:\n${articles!.map((a) => `- ${a.title}: ${a.url}`).join("\n")}` : ""}`;

  const raw = await generateJSON(system, prompt, { smart: true });

  // Parse and clean the JSON — handle markdown code fences
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    subject: parsed.subject || "Follow-up from support",
    body: parsed.body || agentAnswer,
  };
}

export async function refineEmailDraft(params: {
  currentSubject: string;
  currentBody: string;
  instruction: string;
  agentAnswer: string;
  userQuestion: string;
  senderName: string;
  calendlyUrl?: string | null;
}): Promise<{ subject: string; body: string }> {
  const { currentSubject, currentBody, instruction, agentAnswer, userQuestion, senderName, calendlyUrl } = params;

  const system = `You are editing an existing email draft for a customer success team. Modify the draft based on the user's instruction while keeping the email's purpose intact — it's a professional response to a customer inquiry.

Rules:
- Apply the user's instruction to the current draft
- Keep the professional, warm tone
- Do NOT include any sign-off, signature, or sender name at the end
${calendlyUrl ? `- If the Calendly link is present, keep it. Link: ${calendlyUrl}` : ""}
- Format the body as HTML with proper paragraphs (<p> tags), lists (<ul>/<ol>) where appropriate
- Respond with JSON only: { "subject": "...", "body": "..." }`;

  const prompt = `Current email draft:
Subject: ${currentSubject}
Body: ${currentBody}

User's instruction: ${instruction}

Original context (for reference):
Customer question: ${userQuestion}
Agent answer: ${agentAnswer}`;

  const raw = await generateJSON(system, prompt, { smart: true });
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    subject: parsed.subject || currentSubject,
    body: parsed.body || currentBody,
  };
}
