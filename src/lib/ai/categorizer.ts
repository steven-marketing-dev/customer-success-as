import { generateJSON, generateWithThinking } from "./provider";

export interface CategoryResult {
  action: "assign" | "create";
  category_name: string;
  category_description?: string;
  confidence: number;
}

export interface ReclusterResult {
  categories: Array<{
    name: string;
    description: string;
    qa_ids: number[];
  }>;
  unassignedIds: number[];
}

export class Categorizer {
  async categorizeSingle(
    qa: { question: string; question_template?: string | null; answer?: string | null; resolved: boolean },
    existingCategories: Array<{ name: string; description?: string | null; count?: number }>
  ): Promise<CategoryResult> {
    const catsText =
      existingCategories.length === 0
        ? "(None yet — you MUST create the first category)"
        : existingCategories
            .map(
              (c) =>
                `• ${c.name}${c.description ? `: ${c.description}` : ""}${c.count ? ` (${c.count})` : ""}`
            )
            .join("\n");

    const prompt = `Categorize this customer support Q&A into a specific, meaningful category.

Question: ${qa.question}
${qa.question_template ? `Template: ${qa.question_template}` : ""}
Answer: ${(qa.answer ?? "No answer yet").slice(0, 500)}
Resolved: ${qa.resolved ? "Yes" : "No"}

Existing categories:
${catsText}

RULES:
- You MUST assign a specific category. NEVER use "Uncategorized", "Other", or "General".
- STRONGLY PREFER assigning to an existing category. Most Q&A should fit into one of the existing categories if you think broadly about the topic area.
- If the Q&A fits an existing category (even loosely), assign it: {"action": "assign", "category_name": "Exact existing name", "confidence": 0.8}
- Only create a new category if NONE of the existing categories are even remotely related: {"action": "create", "category_name": "Broad Category Name", "category_description": "Clear description of what questions belong here", "confidence": 1.0}
- New categories should be broad product/feature areas (e.g., "Account & User Management", "Reporting & Analytics"), NOT narrow topics.
- Think about what product area or feature domain this question belongs to.

Return ONLY the JSON object.`;

    const system =
      "You are an expert in customer support categorization. You always assign a specific, meaningful category — never 'Uncategorized' or 'Other'. Respond ONLY with valid JSON.";

    // Retry up to 3 times with backoff
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await generateJSON(system, prompt);
        const parsed = this.parseCategorize(text);
        // Reject "Uncategorized" from the model — retry
        if (parsed.category_name.toLowerCase() === "uncategorized" && attempt < 2) {
          continue;
        }
        return parsed;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    // Final fallback — throw so the pipeline logs the actual error
    throw lastError ?? new Error("Categorization failed after 3 attempts");
  }

  async reclusterAll(
    qaPairs: Array<{
      id: number;
      question: string;
      question_template: string | null;
      answer: string | null;
      resolved: number;
    }>
  ): Promise<ReclusterResult> {
    if (qaPairs.length === 0) return { categories: [], unassignedIds: [] };

    const qaText = qaPairs
      .map((qa) => {
        const r = qa.resolved ? "✓" : "✗";
        const tmpl =
          qa.question_template && qa.question_template !== qa.question
            ? `\n  Template: ${qa.question_template}`
            : "";
        const ans = qa.answer ? `\n  R: ${qa.answer.slice(0, 120)}` : "";
        return `[${qa.id}] ${r} ${qa.question}${tmpl}${ans}`;
      })
      .join("\n\n")
      .slice(0, 80000);

    const prompt = `You have ${qaPairs.length} support Q&A pairs. Create a category taxonomy.

${qaText}

Return:
{
  "categories": [
    {
      "name": "Category name",
      "description": "What type of questions it includes",
      "qa_ids": [1, 5, 12]
    }
  ]
}

Rules:
- Target exactly 10–15 categories. Fewer is better than more.
- Categories should be broad enough that each has at least 3–5 Q&A pairs.
- Do NOT create niche categories for 1-2 items — group them into a broader related category.
- Think in terms of product areas or feature domains, not individual issues.
- Good examples: "Account & User Management", "Assessments & Surveys", "Integrations & SSO", "Billing & Subscriptions", "Reporting & Analytics", "Platform Configuration"
- Bad examples: "Password Reset" (too narrow), "Specific Bug #123" (too specific)
- Names in English, each Q&A in exactly 1 category.
Return ONLY the JSON.`;

    const system =
      "You are an expert in customer support taxonomies. Respond ONLY with valid JSON.";

    const text = await generateWithThinking(system, prompt);
    return this.parseRecluster(text, new Set(qaPairs.map((q) => q.id)));
  }

  private parseCategorize(raw: string): CategoryResult {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "");
    const data = JSON.parse(cleaned);
    return {
      action: data.action === "assign" ? "assign" : "create",
      category_name: String(data.category_name ?? "Uncategorized").trim(),
      category_description: data.category_description
        ? String(data.category_description).trim()
        : undefined,
      confidence: Number(data.confidence ?? 0.5),
    };
  }

  private parseRecluster(raw: string, validIds: Set<number>): ReclusterResult {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "");
    const data = JSON.parse(cleaned);

    const categories = (data.categories ?? []).map(
      (cat: { name?: string; description?: string; qa_ids?: number[] }) => ({
        name: String(cat.name ?? "Unnamed").trim(),
        description: String(cat.description ?? "").trim(),
        qa_ids: (cat.qa_ids ?? []).filter((id: number) => validIds.has(id)),
      })
    );

    // Return categories + list of unassigned IDs (handled by pipeline)
    const assigned = new Set(categories.flatMap((c: { qa_ids: number[] }) => c.qa_ids));
    const unassigned = [...validIds].filter((id) => !assigned.has(id));

    return { categories, unassignedIds: unassigned };
  }
}
