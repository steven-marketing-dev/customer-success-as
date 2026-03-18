import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { generateJSON } from "@/lib/ai/provider";

const SYSTEM = `You are a quality analyst for a customer support AI agent. You will receive a list of agent responses that were rated poorly (1-star) by users, along with their feedback.

Your job is to identify recurring patterns or issues and suggest behavioral rules that would prevent these problems.

Return a JSON array of suggested rules. Each rule should have:
- title: short name for the rule
- instruction: clear instruction for the agent to follow
- type: "knowledge" | "solution" | "general"
- scope: "global" (always applies)

Only suggest rules for clear, actionable patterns. Do not create rules for one-off issues.
Maximum 5 rules.`;

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session || session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const repo = new Repository(getDb());
  const lowRated = repo.getLowRatedMessages(30);

  if (lowRated.length === 0) {
    return NextResponse.json({ suggestions: [], message: "No low-rated messages with feedback found" });
  }

  const prompt = `Here are ${lowRated.length} poorly-rated agent responses with user feedback:\n\n${lowRated.map((m, i) => (
    `--- Response ${i + 1} ---\nAgent answer: ${m.content.slice(0, 500)}\nUser feedback: ${m.feedback}\nRated by: ${m.username}\n`
  )).join("\n")}`;

  try {
    const result = await generateJSON(SYSTEM, prompt, { smart: true }) as unknown as Array<{
      title: string;
      instruction: string;
      type: "knowledge" | "solution" | "general";
      scope: "global";
    }>;

    return NextResponse.json({ suggestions: Array.isArray(result) ? result : [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
