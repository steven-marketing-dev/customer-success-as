import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { applyAiEdit } from "@/lib/ai/editor";

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const qaId = parseInt(id, 10);
  const repo = new Repository();

  const qa = repo.getQAPairById(qaId);
  if (!qa) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { instruction } = await req.json() as { instruction: string };
  if (!instruction?.trim()) {
    return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  }

  const steps: string[] = (() => {
    try { return JSON.parse(qa.resolution_steps ?? "[]"); }
    catch { return []; }
  })();

  const result = await applyAiEdit(
    {
      question: qa.question,
      answer: qa.answer,
      resolution_steps: steps,
      summary: qa.summary,
      resolved: !!qa.resolved,
    },
    instruction
  );

  return NextResponse.json(result);
}
