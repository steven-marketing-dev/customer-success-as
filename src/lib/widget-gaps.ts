/**
 * Widget answers where the agent had no documented guidance (DIS-234).
 *
 * /api/widget/chat tells the model to "say plainly that you don't have documented guidance for
 * this exact case" when the retrieved passages don't answer the question, and it does so in a
 * stable wording ("I don't have specific documented guidance on…"). Such questions are stored
 * with status "unanswered" so the usage report lists them under "Questions needing follow-up".
 * "Contact support" alone is not a gap: normal answers often end with it.
 */
const GAP_RE = /\b(?:don't|do not) have (?:any )?(?:specific |detailed |enough )?(?:documented|information|guidance|details|documentation)\b|\bknowledge base (?:doesn't|does not)\b/i;

export function isKnowledgeGapAnswer(answer: string): boolean {
  return GAP_RE.test(answer.replace(/’/g, "'"));
}
