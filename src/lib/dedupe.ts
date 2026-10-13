import { createHash } from "crypto";

/** Collapses identical side-effecting requests (same user + same payload) that arrive
 *  within a short window into a single call: concurrent duplicates share the in-flight
 *  promise and later ones get the cached result. Guards Gmail draft creation and
 *  HubSpot replies against double submits. In-memory, so it covers a single instance. */
const WINDOW_MS = 30_000;
const recent = new Map<string, { at: number; promise: Promise<unknown> }>();

export function dedupeKey(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\u0000")).digest("hex");
}

export async function runOnce<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; duplicate: boolean }> {
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.at > WINDOW_MS) recent.delete(k);

  const hit = recent.get(key);
  if (hit) return { value: (await hit.promise) as T, duplicate: true };

  const promise = fn();
  recent.set(key, { at: now, promise });
  try {
    return { value: await promise, duplicate: false };
  } catch (err) {
    // Failed calls must stay retryable
    recent.delete(key);
    throw err;
  }
}
