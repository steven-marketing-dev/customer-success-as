import { generateJSON } from "./provider";

export interface ExtractedTerm {
  name: string;
  definition: string;
  aliases: string[];
}

const SYSTEM = `You are a product terminology expert. You extract product-specific terms, features, and concepts from customer support content. Respond ONLY with valid JSON.`;

/**
 * Extract product-specific terms from Q&A content.
 * Only returns genuinely new terms — filters against existing term names.
 */
export async function extractTerms(
  content: {
    question: string;
    answer: string | null;
    summary: string | null;
  },
  existingTermNames: string[],
): Promise<ExtractedTerm[]> {
  const existingList = existingTermNames.length > 0
    ? `\nExisting terms (DO NOT re-extract these): ${existingTermNames.join(", ")}`
    : "";

  const prompt = `Extract product-specific terms from this customer support Q&A. Only extract terms that are specific to this product/platform — not generic words like "email", "login", "error", etc.

Q: ${content.question}
A: ${content.answer ?? "(no answer)"}
Summary: ${content.summary ?? "(none)"}
${existingList}

For each NEW term, provide:
- name: The canonical term name (capitalize properly, e.g., "Assessment", "Kingsley AI")
- definition: A brief 1-2 sentence definition based on context
- aliases: Alternative names or abbreviations users might use

Return JSON: {"terms": [{"name": "...", "definition": "...", "aliases": ["..."]}]}
If no new product-specific terms found, return: {"terms": []}

IMPORTANT:
- Only extract terms specific to this product/platform (features, tools, workflows, roles)
- Skip generic IT/support terms (password, account, settings, etc.)
- Skip terms already in the existing list
- Definitions should explain what the term means in the context of this product
- Be conservative — only extract terms you're confident are product-specific`;

  const raw = await generateJSON(SYSTEM, prompt);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    const data = JSON.parse(cleaned);
    if (!Array.isArray(data.terms)) return [];

    return data.terms
      .filter((t: { name?: string; definition?: string }) =>
        t.name?.trim() && t.definition?.trim()
      )
      .map((t: { name: string; definition: string; aliases?: string[] }) => ({
        name: t.name.trim(),
        definition: t.definition.trim(),
        aliases: Array.isArray(t.aliases) ? t.aliases.map(String).filter(Boolean) : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Extract terms from a batch of KB article content.
 * Processes in a single call with multiple articles for efficiency.
 */
export async function extractTermsFromArticles(
  articles: Array<{ title: string; content: string }>,
  existingTermNames: string[],
): Promise<ExtractedTerm[]> {
  if (articles.length === 0) return [];

  const articleText = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.content.slice(0, 1500)}`)
    .join("\n\n---\n\n");

  const existingList = existingTermNames.length > 0
    ? `\nExisting terms (DO NOT re-extract these): ${existingTermNames.join(", ")}`
    : "";

  const prompt = `Extract product-specific terms from these knowledge base articles. Only extract terms that are specific to this product/platform.

${articleText}
${existingList}

For each NEW term, provide:
- name: The canonical term name (capitalize properly)
- definition: A brief 1-2 sentence definition based on the article context
- aliases: Alternative names or abbreviations

Return JSON: {"terms": [{"name": "...", "definition": "...", "aliases": ["..."]}]}

IMPORTANT:
- Only extract terms specific to this product/platform (features, tools, workflows, named concepts)
- Skip generic terms (email, password, settings, dashboard, etc.)
- Skip terms already in the existing list
- Be conservative — quality over quantity`;

  const raw = await generateJSON(SYSTEM, prompt, { smart: true });
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    const data = JSON.parse(cleaned);
    if (!Array.isArray(data.terms)) return [];

    return data.terms
      .filter((t: { name?: string; definition?: string }) =>
        t.name?.trim() && t.definition?.trim()
      )
      .map((t: { name: string; definition: string; aliases?: string[] }) => ({
        name: t.name.trim(),
        definition: t.definition.trim(),
        aliases: Array.isArray(t.aliases) ? t.aliases.map(String).filter(Boolean) : [],
      }));
  } catch {
    return [];
  }
}
