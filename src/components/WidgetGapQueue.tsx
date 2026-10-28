"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, Mail, Check, X } from "lucide-react";

/**
 * Gap queue (DIS-234): widget questions the agent had no documented answer for. Answering one
 * adds a Q&A to the KB, so the agent can answer it from the next question on.
 */
interface WidgetGap {
  question_norm: string;
  question: string;
  answer: string;
  count: number;
  last_asked: number;
  installations: string;
  emailed: boolean;
  topic: string | null;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function WidgetGapQueue() {
  const [gaps, setGaps] = useState<WidgetGap[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/widget-gaps");
      if (res.ok) setGaps((await res.json()).gaps);
    } catch { /* keep the last list */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (g: WidgetGap, action: "answer" | "dismiss") => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/widget-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, questionNorm: g.question_norm, question: g.question, answer: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDone(action === "answer" ? `Added to the knowledge base${data.category ? ` under ${data.category}` : ""}. The agent will use it from the next question.` : "Dismissed. It comes back if someone asks it again.");
      setOpen(null);
      setDraft("");
      setGaps((prev) => prev?.filter((x) => x.question_norm !== g.question_norm) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!gaps) return null;
  const visible = showAll ? gaps : gaps.slice(0, 5);

  return (
    <section data-tour="widget-gaps">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Questions the widget couldn&apos;t answer</h2>
        {gaps.length > 0 && <span className="text-xs text-warm-400">{gaps.length} waiting</span>}
      </div>
      <p className="text-xs text-warm-500 mb-3">Answer each one once and the agent will know it next time. Last 90 days.</p>
      {done && <p className="text-xs text-mint-700 bg-mint-50 rounded-lg px-3 py-2 mb-3">{done}</p>}
      <div className="card-warm overflow-hidden">
        {gaps.length === 0 ? (
          <p className="text-sm text-warm-500 p-5">All caught up. The agent had an answer for every widget question.</p>
        ) : (
          <>
            <ul className="divide-y divide-warm-100">
              {visible.map((g) => (
                <li key={g.question_norm} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <HelpCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-warm-800 text-sm">{g.question}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-warm-500">
                        {g.count > 1 && <span className="font-semibold text-warm-700">Asked {g.count} times</span>}
                        <span>{timeAgo(g.last_asked)}</span>
                        <span>{g.installations}</span>
                        {g.topic && <span className="px-2 py-0.5 rounded-md bg-warm-100 text-warm-600">{g.topic}</span>}
                        {g.emailed && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-mint-50 text-mint-700" title="The KB learns from the HubSpot ticket once support closes it">
                            <Mail size={11} /> Emailed support
                          </span>
                        )}
                      </div>
                      {open === g.question_norm ? (
                        <div className="mt-3 space-y-2">
                          <p className="text-[11px] text-warm-500"><span className="font-semibold">The agent said:</span> {g.answer.slice(0, 240)}{g.answer.length > 240 ? "…" : ""}</p>
                          <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={4}
                            autoFocus
                            placeholder="Write the answer the agent should give. Steps, links and caveats help."
                            className="w-full text-sm border border-warm-200 rounded-xl px-3 py-2 focus:outline-none focus:border-mint-400"
                          />
                          {error && <p className="text-xs text-red-600">{error}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={() => act(g, "answer")}
                              disabled={saving || !draft.trim()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600 disabled:opacity-50"
                            >
                              <Check size={13} /> {saving ? "Saving…" : "Add to knowledge base"}
                            </button>
                            <button onClick={() => { setOpen(null); setDraft(""); setError(null); }} className="px-3 py-1.5 rounded-lg text-xs text-warm-600 hover:bg-warm-100">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => { setOpen(g.question_norm); setDraft(""); setDone(null); setError(null); }}
                            className="px-3 py-1.5 rounded-lg border border-mint-300 text-mint-700 text-xs font-medium hover:bg-mint-50"
                          >
                            Answer it
                          </button>
                          <button
                            onClick={() => act(g, "dismiss")}
                            disabled={saving}
                            title="Not a real question, or not something the agent should answer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-warm-500 hover:bg-warm-100"
                          >
                            <X size={12} /> Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {gaps.length > 5 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="w-full py-2 text-xs text-mint-600 hover:bg-mint-50/50 border-t border-warm-100"
              >
                {showAll ? "Show fewer" : `Show ${gaps.length - 5} more`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
