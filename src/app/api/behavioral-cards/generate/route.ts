import { NextRequest, NextResponse } from "next/server";
import { generateJSON } from "@/lib/ai/provider";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    title: string;
    type: "knowledge" | "solution" | "general";
    scope: "global" | "category";
    category_name?: string;
    partial_instruction?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const system = `You are an expert at writing behavioral rules for a customer support AI agent. You write clear, specific instructions that tell the agent HOW to respond to questions. Respond ONLY with valid JSON.`;

  const prompt = `Generate a behavioral rule instruction for a customer support AI agent.

Rule title: "${body.title}"
Type: ${body.type} (${body.type === "knowledge" ? "user wants understanding/explanation" : body.type === "solution" ? "user wants actionable steps/fix" : "general formatting/style rule"})
Scope: ${body.scope}${body.scope === "category" && body.category_name ? ` (category: ${body.category_name})` : ""}
${body.partial_instruction ? `User's draft (expand/improve this): "${body.partial_instruction}"` : ""}

Write a concise, specific instruction (1-3 sentences) that tells the agent exactly how to behave when this rule applies. Be precise about what to include, exclude, or how to structure the response.

Return JSON: {"instruction": "the complete instruction text"}`;

  try {
    const raw = await generateJSON(system, prompt, { smart: true });
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
    const data = JSON.parse(cleaned);
    return NextResponse.json({ instruction: String(data.instruction ?? "") });
  } catch {
    return NextResponse.json({ error: "Failed to generate instruction" }, { status: 500 });
  }
}
