import { NextRequest, NextResponse } from "next/server";
import { getDb, rebuildFtsIndexes } from "@/lib/db/index";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { Categorizer } from "@/lib/ai/categorizer";

/**
 * Gap queue (DIS-234): widget questions the agent had no documented answer for.
 * GET lists the open ones (last 90 days). POST { action: "answer", questionNorm, question, answer }
 * turns CS's answer into a Q&A the agent uses from the next question on;
 * POST { action: "dismiss", questionNorm } hides it until someone asks it again.
 */
const WINDOW_SECONDS = 90 * 86400;

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const repo = new Repository(getDb());
  const gaps = repo.listWidgetGaps(Math.floor(Date.now() / 1000) - WINDOW_SECONDS)
    .map((g) => ({ ...g, emailed: !!g.emailed, topic: repo.topCategoryOf(g.question)?.name ?? null }));
  return NextResponse.json({ gaps });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { action?: string; questionNorm?: string; question?: string; answer?: string };
  const questionNorm = body.questionNorm?.trim();
  if (!questionNorm) return NextResponse.json({ error: "questionNorm is required" }, { status: 400 });
  const repo = new Repository(getDb());

  if (body.action === "dismiss") {
    repo.reviewWidgetGap(questionNorm, "dismissed", null, session.userId);
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "answer") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const question = body.question?.trim();
  const answer = body.answer?.trim();
  if (!question || !answer) return NextResponse.json({ error: "Question and answer are required" }, { status: 400 });

  const qa = repo.createWidgetGapQA(question, answer);
  // Same category as the closest existing Q&A; the AI categorizer only when nothing is close
  let category = repo.topCategoryOf(`${question} ${answer}`);
  if (!category) {
    try {
      const existing = repo.getAllCategories().map((c) => ({ name: c.name, description: c.description, count: c.qa_count }));
      const r = await new Categorizer().categorizeSingle({ question, answer, resolved: true }, existing);
      const c = repo.getOrCreateCategory(r.category_name, r.category_description);
      category = { id: c.id, name: c.name };
    } catch { /* the Q&A still works without a category */ }
  }
  if (category) repo.assignCategory(qa.id, category.id);
  repo.autoLinkTermsToQA(qa.id);
  rebuildFtsIndexes();
  repo.reviewWidgetGap(questionNorm, "answered", qa.id, session.userId);
  return NextResponse.json({ ok: true, qaId: qa.id, category: category?.name ?? null });
}
