import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { rebuildFtsIndexes } from "@/lib/db/index";
import type { CorrectionProposal } from "@/lib/ai/corrector";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    agentQuestion: string;
    agentAnswer: string;
    feedback: string;
    corrections: CorrectionProposal[];
    behavioralSuggestion?: {
      action: "create" | "update";
      update_id?: number;
      title: string;
      instruction: string;
      type: "knowledge" | "solution" | "general";
      scope: "global" | "category";
      category_name?: string;
    } | null;
  };

  if (!body.corrections?.length && !body.behavioralSuggestion) {
    return NextResponse.json({ error: "No corrections or suggestions provided" }, { status: 400 });
  }

  const repo = new Repository();
  const updated: number[] = [];
  const correctionLogIds: number[] = [];

  for (const correction of (body.corrections ?? [])) {
    const existing = repo.getQAPairById(correction.qa_id);
    if (!existing) continue;

    // Build update fields
    const fields: Record<string, unknown> = {};
    const changes = correction.changes;

    if (changes.question !== undefined) fields.question = changes.question;
    if (changes.answer !== undefined) fields.answer = changes.answer;
    if (changes.resolution_steps !== undefined) {
      fields.resolution_steps = JSON.stringify(changes.resolution_steps);
    }
    if (changes.summary !== undefined) fields.summary = changes.summary;
    if (changes.resolved !== undefined) fields.resolved = changes.resolved ? 1 : 0;

    if (Object.keys(fields).length === 0) continue;

    // Update the QA card
    repo.updateQAPair(correction.qa_id, fields);

    // Log each changed field
    for (const [fieldName, newValue] of Object.entries(fields)) {
      const oldValue = (existing as unknown as Record<string, unknown>)[fieldName];
      const log = repo.createCorrectionLog({
        qa_id: correction.qa_id,
        agent_question: body.agentQuestion,
        agent_answer: body.agentAnswer,
        user_feedback: body.feedback,
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
      });
      correctionLogIds.push(log.id);
    }

    updated.push(correction.qa_id);
  }

  // Create or update behavioral card if suggested
  let behavioralCardId: number | null = null;
  let behavioralAction: "created" | "updated" | null = null;
  if (body.behavioralSuggestion) {
    const s = body.behavioralSuggestion;
    let categoryId: number | null = null;
    if (s.scope === "category" && s.category_name) {
      const cat = repo.getOrCreateCategory(s.category_name, "");
      categoryId = cat.id;
    }

    if (s.action === "update" && s.update_id) {
      // Update existing behavioral card
      const existing = repo.getBehavioralCardById(s.update_id);
      if (existing) {
        repo.updateBehavioralCard(s.update_id, {
          title: s.title,
          instruction: s.instruction,
          type: s.type,
          scope: s.scope,
          category_id: categoryId,
        });
        behavioralCardId = s.update_id;
        behavioralAction = "updated";
      }
    }

    if (!behavioralCardId) {
      // Create new behavioral card
      const card = repo.createBehavioralCard({
        title: s.title,
        instruction: s.instruction,
        type: s.type,
        scope: s.scope,
        category_id: categoryId,
        source: "correction",
        correction_log_id: correctionLogIds[0] ?? null,
      });
      behavioralCardId = card.id;
      behavioralAction = "created";
    }
  }

  rebuildFtsIndexes();

  return NextResponse.json({ updated, correctionLogIds, behavioralCardId, behavioralAction });
}
