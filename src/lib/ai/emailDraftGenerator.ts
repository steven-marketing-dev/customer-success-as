import { generateJSON } from "./provider";

/** Reads the model's draft. The body is HTML, and asking for it inside JSON broke whenever the
 *  answer quoted UI labels ("Edit Status"): the model left the quotes unescaped and JSON.parse
 *  threw. So the prompt asks for SUBJECT:/BODY: blocks; valid JSON is still accepted. */
export function parseDraft(raw: string): { subject: string; body: string } {
  const cleaned = raw.replace(/```(?:json|html)?\n?/g, "").trim();

  if (cleaned.startsWith("{")) {
    try {
      const json = JSON.parse(cleaned) as Record<string, unknown>;
      const pick = (k: string) => {
        const key = Object.keys(json).find((x) => x.toLowerCase() === k);
        return key && typeof json[key] === "string" ? (json[key] as string).trim() : "";
      };
      return { subject: pick("subject"), body: pick("body") };
    } catch {
      // JSON with unescaped quotes inside the HTML: take the fields by position
      const subject = cleaned.match(/"subject"\s*:\s*"([\s\S]*?)"\s*,\s*"body"/i)?.[1] ?? "";
      const body = cleaned.match(/"body"\s*:\s*"([\s\S]*)"\s*}\s*$/i)?.[1] ?? "";
      if (body) return { subject: subject.trim(), body: body.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() };
    }
  }

  const subject = cleaned.match(/^\s*SUBJECT:\s*(.+)$/im)?.[1].trim() ?? "";
  const bodyStart = cleaned.search(/^\s*BODY:/im);
  const body = bodyStart >= 0 ? cleaned.slice(bodyStart).replace(/^\s*BODY:\s*/i, "").trim() : "";
  return { subject, body };
}

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
${hasArticles ? `- Include a "Helpful Resources" section near the end of the body with the provided KB articles as clickable links. Format as: <p><strong>Helpful Resources:</strong></p><ul> with <li><a href="URL">Title</a></li> for each article.` : ""}
${calendlyUrl ? `- AFTER the articles (if any), include as the very last line: "If you'd like to discuss this further, feel free to <a href="${calendlyUrl}">schedule a call</a>." CRITICAL: Use EXACTLY this URL, do NOT modify or create any other Calendly link.` : ""}
- Format the body as HTML with proper paragraphs (<p> tags), lists (<ul>/<ol>) where appropriate
- Do NOT include any citation lines (SOURCES, REFS, ARTICLES, VIDEOS) from the original response
- Respond in exactly this format, with no JSON and no code fences:
SUBJECT: <subject line>
BODY:
<HTML body>`;

  const prompt = `Original customer question:
${userQuestion}

Agent response to convert into an email:
${agentAnswer}
${hasArticles ? `\nKB Articles to include:\n${articles!.map((a) => `- ${a.title}: ${a.url}`).join("\n")}` : ""}`;

  const raw = await generateJSON(system, prompt, { smart: true });
  const parsed = parseDraft(raw);

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
${calendlyUrl ? `- If the Calendly link is present, keep it EXACTLY as: ${calendlyUrl} Do NOT modify, replace, or create any other Calendly link.` : ""}
- Format the body as HTML with proper paragraphs (<p> tags), lists (<ul>/<ol>) where appropriate
- Respond in exactly this format, with no JSON and no code fences:
SUBJECT: <subject line>
BODY:
<HTML body>`;

  const prompt = `Current email draft:
Subject: ${currentSubject}
Body: ${currentBody}

User's instruction: ${instruction}

Original context (for reference):
Customer question: ${userQuestion}
Agent answer: ${agentAnswer}`;

  const raw = await generateJSON(system, prompt, { smart: true });
  const parsed = parseDraft(raw);

  return {
    subject: parsed.subject || currentSubject,
    body: parsed.body || currentBody,
  };
}
