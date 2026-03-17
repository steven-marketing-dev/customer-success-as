/**
 * AI Provider abstraction — switch between Claude and Gemini via AI_PROVIDER env var.
 *
 * AI_PROVIDER = "claude" (default) | "gemini"
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

export type Provider = "claude" | "gemini";

export function getProvider(): Provider {
  const v = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  return v === "gemini" ? "gemini" : "claude";
}

// Claude model tiers
const CLAUDE_FAST = "claude-haiku-4-5-20251001";   // Pipeline bulk work (extraction, categorization, merge)
const CLAUDE_SMART = "claude-sonnet-4-20250514";    // User-facing (agent chat, AI editor, recluster)

// ─── Rate limit retry helper ──────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Anthropic.RateLimitError ||
        (err instanceof Error && err.message.includes("429"));

      if (isRateLimit && attempt < maxRetries) {
        // Exponential backoff: 5s, 15s, 30s
        const delay = Math.min(5000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

// ─── JSON generation (extraction, categorization) ─────────────────────────

export async function generateJSON(
  system: string,
  prompt: string,
  { smart = false }: { smart?: boolean } = {},
): Promise<string> {
  if (getProvider() === "gemini") {
    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");
    const model = genai.getGenerativeModel({
      model: smart ? "gemini-2.5-pro" : "gemini-2.5-flash",
      systemInstruction: system,
      generationConfig: { responseMimeType: "application/json" },
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  return withRetry(async () => {
    const client = new Anthropic();
    const result = await client.messages.create({
      model: smart ? CLAUDE_SMART : CLAUDE_FAST,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = result.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text : "";
  });
}

// ─── JSON generation with multimodal (images) ────────────────────────────

export async function generateJSONMultimodal(
  system: string,
  prompt: string,
  images: Array<{ mimeType: string; data: string }> = [],
): Promise<string> {
  if (images.length === 0) return generateJSON(system, prompt);

  if (getProvider() === "gemini") {
    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: system,
      generationConfig: { responseMimeType: "application/json" },
    });
    const parts: Part[] = [{ text: prompt }];
    for (const img of images.slice(0, 5)) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    const result = await model.generateContent(parts);
    return result.response.text();
  }

  return withRetry(async () => {
    const client = new Anthropic();
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    for (const img of images.slice(0, 5)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: img.data,
        },
      });
    }
    content.push({ type: "text", text: prompt });

    const result = await client.messages.create({
      model: CLAUDE_FAST,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content }],
    });
    const block = result.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text : "";
  });
}

// ─── Extended thinking generation (recluster) ─────────────────────────────

export async function generateWithThinking(
  system: string,
  prompt: string,
): Promise<string> {
  if (getProvider() === "gemini") {
    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: system,
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: -1 },
      } as object,
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  return withRetry(async () => {
    const client = new Anthropic();
    const result = await client.messages.create({
      model: CLAUDE_SMART,
      max_tokens: 16000,
      thinking: { type: "enabled", budget_tokens: 10000 },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = result.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text : "";
  });
}

// ─── Streaming chat (agent) ───────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function* streamChat(
  system: string,
  history: ChatMessage[],
  userMessage: string,
  opts?: { smart?: boolean },
): AsyncGenerator<string> {
  if (getProvider() === "gemini") {
    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: system,
    });
    const geminiHistory = history.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessageStream(userMessage);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
    return;
  }

  // Claude streaming — uses smart model for user-facing chat, with rate-limit retry
  const client = new Anthropic();
  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = client.messages.stream({
        model: CLAUDE_SMART,
        max_tokens: 4096,
        system,
        messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      return; // success — exit
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < maxRetries) {
        const retryAfter = (err as { headers?: Record<string, string> }).headers?.["retry-after"];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 15_000;
        console.warn(`[streamChat] Rate limited, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}
