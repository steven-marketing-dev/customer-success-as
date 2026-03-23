import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { generateCorrectionPreview } from "@/lib/ai/corrector";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    agentQuestion: string;
    agentAnswer: string;
    feedback: string;
    sourceIds: number[];
  };

  if (!body.feedback?.trim()) {
    return NextResponse.json({ error: "Feedback is required" }, { status: 400 });
  }

  const repo = new Repository();
  const sourceIds = body.sourceIds ?? [];

  // Fetch source QAs with category names
  const sourceQAs = sourceIds.map((id) => {
    const qa = repo.getQAPairWithCategory(id);
    if (!qa) return null;
    return {
      id: qa.id,
      question: qa.question,
      answer: qa.answer ?? null,
      resolution_steps: (() => {
        try { return JSON.parse(qa.resolution_steps ?? "[]") as string[]; }
        catch { return []; }
      })(),
      summary: qa.summary ?? null,
      resolved: Boolean(qa.resolved),
      category_name: (qa as unknown as Record<string, unknown>).category_name as string | undefined,
    };
  }).filter(Boolean) as Array<{
    id: number;
    question: string;
    answer: string | null;
    resolution_steps: string[];
    summary: string | null;
    resolved: boolean;
    category_name?: string;
  }>;

  // Fetch prior corrections for each source QA
  const priorCorrections: Record<number, Array<{
    id: number; field_name: string; old_value: string | null;
    new_value: string | null; user_feedback: string; created_at: number;
  }>> = {};

  for (const qa of sourceQAs) {
    try {
      const logs = repo.getCorrectionLogsForQA(qa.id);
      if (logs.length > 0) {
        priorCorrections[qa.id] = logs.map((l) => ({
          id: l.id,
          field_name: l.field_name,
          old_value: l.old_value,
          new_value: l.new_value,
          user_feedback: l.user_feedback,
          created_at: l.created_at,
        }));
      }
    } catch { /* table may not exist */ }
  }

  // Fetch existing behavioral cards linked to these QAs' corrections
  let existingRules: Array<{ id: number; title: string; instruction: string; type: string; scope: string; active: number; category_name?: string }> = [];
  try {
    const qaIds = sourceQAs.map((q) => q.id);
    existingRules = repo.getBehavioralCardsForQAs(qaIds).map((c) => ({
      id: c.id, title: c.title, instruction: c.instruction,
      type: c.type, scope: c.scope, active: c.active,
      category_name: c.category_name,
    }));
  } catch { /* table may not exist */ }

  // If no source QAs, still allow correction — AI will suggest behavioral rules only
  if (sourceQAs.length === 0) {
    const result = await generateCorrectionPreview(
      body.agentQuestion,
      body.agentAnswer,
      body.feedback,
      [],
      [],
    );
    return NextResponse.json({ ...result, priorCorrections: {}, existingRules: [] });
  }

  // Format prior corrections for the AI prompt
  const priorCorrectionsForAI = Object.entries(priorCorrections).flatMap(
    ([qaId, logs]) => logs.map((l) => ({
      qa_id: Number(qaId),
      field_name: l.field_name,
      old_value: l.old_value,
      new_value: l.new_value,
      feedback: l.user_feedback,
    }))
  );

  const result = await generateCorrectionPreview(
    body.agentQuestion,
    body.agentAnswer,
    body.feedback,
    sourceQAs,
    priorCorrectionsForAI,
    existingRules,
  );

  return NextResponse.json({ ...result, priorCorrections, existingRules });
}
