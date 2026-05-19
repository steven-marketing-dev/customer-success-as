/**
 * Lightweight proper-noun / product-name extractor.
 *
 * Surfaces entities like "Indeed", "LinkedIn", "Glassdoor", "Stripe" that span
 * across categories. Pure JS (regex + stopword set), runs in milliseconds over
 * a few thousand qa_pair texts. No AI, no NER library.
 *
 * Heuristic: capitalized words 3+ chars, filtered by:
 *   - English common words / sentence starters / generic verbs / months / days
 *   - The user's own product names (configurable via PRODUCT_NAME_STOPWORDS)
 *   - Tokens that don't appear in at least `minDocFreq` distinct documents
 *     (prevents one verbose ticket from dominating).
 *
 * Returns entities ranked by *document frequency* (number of distinct qa_pairs
 * mentioning it), with a secondary sort on total mentions.
 */

const STOPWORDS = new Set([
  // Sentence starters / questions
  "the", "a", "an", "i", "we", "you", "your", "my", "our", "their", "they",
  "he", "she", "it", "this", "that", "these", "those", "there", "here",
  "how", "what", "when", "why", "where", "who", "which", "whom",
  // Modals / generic verbs
  "can", "could", "should", "would", "will", "do", "does", "did", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "having",
  "may", "might", "must", "shall", "let", "get", "got", "make", "made",
  // Common adjectives / adverbs
  "new", "old", "good", "bad", "best", "more", "less", "all", "some", "any",
  "every", "each", "many", "much", "few", "several", "only", "just", "now",
  "then", "still", "yet", "ever", "never", "often", "sometimes", "always",
  // Sentence transitions (start with capital after period). NOTE: "indeed" is
  // intentionally NOT in this list — Indeed is a job board and the user wants it
  // surfaced. Sentence-transition use of the word is rare in support tickets.
  "however", "moreover", "therefore", "thus", "hence", "additionally",
  "furthermore", "meanwhile", "otherwise", "instead", "regardless",
  "anyway", "anyhow", "besides", "consequently", "essentially", "ultimately",
  "afterward", "afterwards", "previously", "currently", "recently", "lately",
  // Common nouns that get capitalized at sentence start
  "user", "client", "customer", "company", "team", "issue", "issues", "problem",
  "request", "requests", "ticket", "tickets", "page", "pages", "site", "system",
  "platform", "service", "services", "feature", "features", "account", "data",
  "test", "tests", "job", "jobs", "post", "posts", "candidate", "candidates",
  "email", "emails", "report", "reports", "link", "url", "form", "field",
  "subject", "topic", "thread", "support", "agent", "admin", "owner", "manager",
  "name", "type", "code", "status", "info", "details", "settings", "section",
  // Months / weekdays
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Polite words / common conversation
  "hi", "hello", "hey", "thanks", "thank", "please", "yes", "no", "okay",
  // Random short capitalized words that aren't entities
  "and", "or", "but", "so", "if", "for", "to", "in", "on", "at", "by", "of",
  "from", "with", "without", "into", "onto", "out", "over", "under", "after",
  "before", "during", "since", "until", "while", "than", "as", "like", "such",
  // Their own product names — known not-an-entity for this user's data
  "discovered", "dai", "ats", "myaccount",
  // Pronouns ALL CAPS
  "id", "url", "api", "http", "https", "www", "com",
]);

export interface ExtractedEntity {
  name: string;
  total_mentions: number;
  doc_count: number; // distinct qa_pairs that mention it
}

/** Extract entities from a list of texts. Each text is one document (qa_pair). */
export function extractEntities(
  documents: string[],
  opts: { minDocFreq?: number; limit?: number; extraStopwords?: Iterable<string> } = {}
): ExtractedEntity[] {
  const minDocFreq = opts.minDocFreq ?? 2;
  const limit = opts.limit ?? 5;
  const stopwords = new Set([...STOPWORDS, ...(opts.extraStopwords ? Array.from(opts.extraStopwords).map((s) => s.toLowerCase()) : [])]);

  const totalCount = new Map<string, number>();   // total mentions per entity
  const docCount = new Map<string, number>();     // distinct documents mentioning entity
  const displayName = new Map<string, string>();  // canonical capitalization

  for (const text of documents) {
    if (!text) continue;
    const matches = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) ?? [];
    const seenInDoc = new Set<string>();
    for (const raw of matches) {
      const key = raw.toLowerCase();
      if (stopwords.has(key)) continue;
      // Skip pure numbers / version-like tokens that start with letter+digits
      if (/^[a-z]\d+$/.test(key)) continue;

      totalCount.set(key, (totalCount.get(key) ?? 0) + 1);
      if (!seenInDoc.has(key)) {
        seenInDoc.add(key);
        docCount.set(key, (docCount.get(key) ?? 0) + 1);
      }
      // Prefer the most-Title-Cased version we've seen (Indeed > INDEED > indeed)
      const existing = displayName.get(key);
      if (!existing || preferDisplay(raw, existing)) displayName.set(key, raw);
    }
  }

  const entities: ExtractedEntity[] = [];
  for (const [key, total] of totalCount.entries()) {
    const docs = docCount.get(key) ?? 0;
    if (docs < minDocFreq) continue;
    entities.push({
      name: displayName.get(key) ?? key,
      total_mentions: total,
      doc_count: docs,
    });
  }

  return entities
    .sort((a, b) => b.doc_count - a.doc_count || b.total_mentions - a.total_mentions)
    .slice(0, limit);
}

/** Prefer Title Case "Indeed" over ALL CAPS "INDEED" or lowercase "indeed". */
function preferDisplay(candidate: string, current: string): boolean {
  const isTitle = (s: string) => /^[A-Z][a-z]+/.test(s);
  if (isTitle(candidate) && !isTitle(current)) return true;
  return false;
}
