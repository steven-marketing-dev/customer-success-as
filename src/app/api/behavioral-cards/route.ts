import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";

export async function GET() {
  const repo = new Repository();
  const cards = repo.getAllBehavioralCards();
  return NextResponse.json(cards);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    title: string;
    instruction: string;
    type: "knowledge" | "solution" | "general";
    scope: "global" | "category";
    category_id?: number | null;
    source?: string;
    correction_log_id?: number | null;
  };

  if (!body.title?.trim() || !body.instruction?.trim()) {
    return NextResponse.json({ error: "Title and instruction are required" }, { status: 400 });
  }

  if (!["knowledge", "solution", "general"].includes(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  if (!["global", "category"].includes(body.scope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const repo = new Repository();
  const card = repo.createBehavioralCard({
    title: body.title.trim(),
    instruction: body.instruction.trim(),
    type: body.type,
    scope: body.scope,
    category_id: body.category_id ?? null,
    source: body.source ?? "manual",
    correction_log_id: body.correction_log_id ?? null,
  });

  return NextResponse.json(card);
}
