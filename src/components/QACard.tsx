"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  ExternalLink,
  Sparkles,
  Plus,
  Trash2,
  Save,
  X,
  Loader2,
} from "lucide-react";

export interface QAItem {
  id: number;
  question: string;
  question_template?: string | null;
  question_variables?: string | null;
  answer?: string | null;
  resolution_steps?: string | null; // JSON string: string[]
  summary?: string | null;
  resolved: number;
  channel?: string | null;
  category_name?: string | null;
  hubspot_id?: string | null;
  created_at?: number;
}

interface Props {
  qa: QAItem;
  onUpdate?: (updated: QAItem) => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  chat: "Chat",
  phone: "Phone",
  web_form: "Web Form",
  unknown: "Unknown",
};

const CATEGORY_COLORS: Record<string, string> = {};
const PALETTE = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-mint-100 text-mint-700",
];
let colorIdx = 0;

function getCategoryColor(name?: string | null) {
  if (!name) return "bg-slate-100 text-slate-600";
  if (!CATEGORY_COLORS[name]) {
    CATEGORY_COLORS[name] = PALETTE[colorIdx++ % PALETTE.length];
  }
  return CATEGORY_COLORS[name];
}

function parseSteps(raw?: string | null): string[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

function parseVariables(raw?: string | null): Record<string, string> {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (Array.isArray(parsed)) {
      const obj: Record<string, string> = {};
      for (const v of parsed) obj[v.name] = v.value;
      return obj;
    }
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getHubSpotUrl(hubspotId: string): string | null {
  const hubId = process.env.NEXT_PUBLIC_HUBSPOT_HUB_ID;
  if (!hubId) return null;
  return `https://app.hubspot.com/contacts/${hubId}/ticket/${hubspotId}`;
}

export function QACard({ qa, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit state
  const [editQuestion, setEditQuestion] = useState(qa.question);
  const [editAnswer, setEditAnswer] = useState(qa.answer ?? "");
  const [editSteps, setEditSteps] = useState<string[]>(parseSteps(qa.resolution_steps));
  const [editResolved, setEditResolved] = useState(!!qa.resolved);
  const [editSummary, setEditSummary] = useState(qa.summary ?? "");

  // AI edit
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);

  const variables = parseVariables(qa.question_variables);
  const steps = parseSteps(qa.resolution_steps);
  const hasContent = !!(qa.answer || steps.length > 0);
  const varEntries = Object.entries(variables).filter(([, v]) => v);

  const hubspotUrl = qa.hubspot_id ? getHubSpotUrl(qa.hubspot_id) : null;

  const startEdit = () => {
    setEditQuestion(qa.question);
    setEditAnswer(qa.answer ?? "");
    setEditSteps(parseSteps(qa.resolution_steps));
    setEditResolved(!!qa.resolved);
    setEditSummary(qa.summary ?? "");
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setAiInstruction("");
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const body = {
        question: editQuestion,
        answer: editAnswer || null,
        resolution_steps: editSteps.filter(Boolean).length > 0 ? JSON.stringify(editSteps.filter(Boolean)) : null,
        summary: editSummary || null,
        resolved: editResolved ? 1 : 0,
      };
      const res = await fetch(`/api/qa/${qa.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json() as QAItem;
        onUpdate?.(updated);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const runAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/qa/${qa.id}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: aiInstruction }),
      });
      if (res.ok) {
        const data = await res.json() as {
          question?: string;
          answer?: string | null;
          resolution_steps?: string[];
          summary?: string;
          resolved?: boolean;
        };
        if (data.question !== undefined) setEditQuestion(data.question);
        if (data.answer !== undefined) setEditAnswer(data.answer ?? "");
        if (data.resolution_steps !== undefined) setEditSteps(data.resolution_steps);
        if (data.summary !== undefined) setEditSummary(data.summary);
        if (data.resolved !== undefined) setEditResolved(data.resolved);
        setAiInstruction("");
      }
    } finally {
      setAiLoading(false);
    }
  };

  // ─── Edit Mode ──────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="flex flex-col bg-white rounded-xl border-2 border-mint-300 shadow-md overflow-hidden">
        <div className="p-4 space-y-3">
          {/* Question */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Question</label>
            <textarea
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-mint-500 resize-none"
            />
          </div>

          {/* Answer */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Answer</label>
            <textarea
              value={editAnswer}
              onChange={(e) => setEditAnswer(e.target.value)}
              rows={3}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-mint-500 resize-none"
              placeholder="No answer yet..."
            />
          </div>

          {/* Resolution Steps */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Resolution Steps</label>
            <div className="mt-1 space-y-1.5">
              {editSteps.map((step, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center mt-1.5">
                    {i + 1}
                  </span>
                  <input
                    value={step}
                    onChange={(e) => {
                      const next = [...editSteps];
                      next[i] = e.target.value;
                      setEditSteps(next);
                    }}
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-mint-500"
                  />
                  <button
                    onClick={() => setEditSteps(editSteps.filter((_, j) => j !== i))}
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditSteps([...editSteps, ""])}
                className="flex items-center gap-1.5 text-xs text-mint-600 hover:text-mint-800 font-medium mt-1"
              >
                <Plus size={12} /> Add step
              </button>
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Summary</label>
            <input
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-mint-500"
              placeholder="Brief summary..."
            />
          </div>

          {/* Resolved toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editResolved}
              onChange={(e) => setEditResolved(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-mint-600 focus:ring-mint-500"
            />
            <span className="text-sm text-slate-700">Resolved</span>
          </label>
        </div>

        {/* AI Assistant */}
        <div className="px-4 py-3 bg-mint-50 border-t border-mint-100">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Sparkles size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mint-400" />
              <input
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && runAiEdit()}
                placeholder="Tell AI what to change..."
                disabled={aiLoading}
                className="w-full pl-9 pr-3 py-2 text-sm border border-mint-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-mint-500 placeholder-mint-300 disabled:opacity-50"
              />
            </div>
            <button
              onClick={runAiEdit}
              disabled={aiLoading || !aiInstruction.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-mint-600 text-white hover:bg-mint-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Apply
            </button>
          </div>
        </div>

        {/* Save / Cancel */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100">
          <button
            onClick={cancelEdit}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1.5"
          >
            <X size={14} /> Cancel
          </button>
          <button
            onClick={saveEdit}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-mint-600 text-white hover:bg-mint-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>
    );
  }

  // ─── View Mode ──────────────────────────────────────────────────────────

  return (
    <div className="group flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
      {/* Header — grows to fill space */}
      <div className="flex-1 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            {qa.resolved ? (
              <CheckCircle2 size={18} className="text-emerald-500" />
            ) : (
              <XCircle size={18} className="text-amber-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-slate-900 leading-snug line-clamp-3" title={qa.question}>
                {qa.question}
              </p>
              {onUpdate && (
                <button
                  onClick={startEdit}
                  className="flex-shrink-0 p-1 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-mint-600 hover:bg-mint-50 transition-all"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {qa.category_name && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(qa.category_name)}`}
                >
                  {qa.category_name}
                </span>
              )}
              {qa.channel && qa.channel !== "unknown" && (
                <span className="text-xs text-slate-400">
                  {CHANNEL_LABELS[qa.channel] ?? qa.channel}
                </span>
              )}
              {varEntries.length > 0 && (
                <span className="text-xs text-slate-400 truncate max-w-[200px]">
                  {varEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer buttons — pinned to bottom */}
      {hasContent ? (
        <>
          <button
            onClick={() => setExpanded((p) => !p)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <span>
              {steps.length > 0
                ? `View resolution (${steps.length} steps)`
                : "View answer"}
            </span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {expanded && (
            <div className="border-t border-slate-100 bg-slate-50">
              {qa.answer && (
                <div className="px-4 pt-3 pb-2">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {qa.answer}
                  </p>
                </div>
              )}

              {steps.length > 0 && (
                <div className="px-4 pt-2 pb-3">
                  {qa.answer && (
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">
                      Resolution Steps
                    </p>
                  )}
                  <ol className="space-y-1.5">
                    {steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      ) : hubspotUrl ? (
        /* Unresolved with no content — show HubSpot link */
        <a
          href={hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs font-medium text-mint-600 hover:text-mint-800 hover:bg-mint-50 transition-colors"
        >
          <span>View in HubSpot</span>
          <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
}
