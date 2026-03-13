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
  if (!body.sourceIds?.length) {
    return NextResponse.json({ error: "No source QA cards provided" }, { status: 400 });
  }

  const repo = new Repository();

  // Fetch source QAs with category names
  const sourceQAs = body.sourceIds.map((id) => {
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

  if (sourceQAs.length === 0) {
    return NextResponse.json({ error: "No valid source QA cards found" }, { status: 404 });
  }

  const result = await generateCorrectionPreview(
    body.agentQuestion,
    body.agentAnswer,
    body.feedback,
    sourceQAs,
  );

  return NextResponse.json(result);
}
