import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import type { CorrectionProposal } from "@/lib/ai/corrector";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    agentQuestion: string;
    agentAnswer: string;
    feedback: string;
    corrections: CorrectionProposal[];
  };

  if (!body.corrections?.length) {
    return NextResponse.json({ error: "No corrections provided" }, { status: 400 });
  }

  const repo = new Repository();
  const updated: number[] = [];

  for (const correction of body.corrections) {
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
      repo.createCorrectionLog({
        qa_id: correction.qa_id,
        agent_question: body.agentQuestion,
        agent_answer: body.agentAnswer,
        user_feedback: body.feedback,
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
      });
    }

    updated.push(correction.qa_id);
  }

  return NextResponse.json({ updated });
}
