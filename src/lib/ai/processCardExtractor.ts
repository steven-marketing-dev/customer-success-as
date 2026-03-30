import { generateJSON } from "./provider";

export interface ExtractedProcessCard {
  title: string;
  summary: string;
  steps: string[];
}

const SYSTEM = `You are an expert at analyzing training video transcripts for a customer success platform (Discovered ATS). Extract distinct step-by-step processes from the transcript. Respond ONLY with valid JSON.`;

/**
 * Extract structured process cards from a video transcript.
 * Each card represents a distinct step-by-step process found in the transcript.
 */
export async function extractProcessCards(
  transcript: string,
  sourceContext: string,
): Promise<ExtractedProcessCard[]> {
  const truncated = transcript.slice(0, 8000);

  const prompt = `Analyze the following training video transcript and extract distinct step-by-step processes.

Source context: ${sourceContext}

Transcript:
${truncated}

Return JSON: {"cards": [{"title": "...", "summary": "...", "steps": ["Step 1...", "Step 2..."]}]}

IMPORTANT:
- If the video covers multiple distinct processes, create one card per process
- If it covers a single process, return exactly one card
- Titles should be action-oriented (e.g., "How to Remove an Assessment from a Job Posting")
- Steps should be concrete and actionable, referencing exact UI elements mentioned
- Summary should be 2-3 sentences explaining what the process accomplishes and when to use it
- The transcript may have auto-generated captions with errors — focus on intent
- If the transcript is too vague or doesn't contain actionable processes, return {"cards": []}`;

  const raw = await generateJSON(SYSTEM, prompt);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    const data = JSON.parse(cleaned);
    if (!Array.isArray(data.cards)) return [];

    return data.cards
      .filter(
        (c: { title?: string; summary?: string; steps?: unknown }) =>
          c.title?.trim() && c.summary?.trim() && Array.isArray(c.steps) && c.steps.length > 0,
      )
      .map((c: { title: string; summary: string; steps: string[] }) => ({
        title: c.title.trim(),
        summary: c.summary.trim(),
        steps: c.steps.map(String).filter(Boolean),
      }));
  } catch {
    return [];
  }
}
