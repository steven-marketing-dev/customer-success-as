"use client";

import { useState, useRef, useEffect, FormEvent, useCallback, useImperativeHandle, forwardRef } from "react";
import { Send, Bot, User, Loader2, BookOpen, AlertCircle, Globe, Tag, Flag, Check, Sparkles, Plus, MessageSquare, Trash2, Star, ChevronLeft, ChevronRight, ChevronDown, Users, Paperclip, Mail } from "lucide-react";
import { type QAItem } from "./QACard";
import EmailDraftModal from "./EmailDraftModal";

/** Lightweight markdown→HTML. No headings (h1-h6), just inline formatting + lists + code blocks. */
function renderMarkdown(text: string): string {
  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Strip code fences but keep the text content
  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_m, code) => code.trimEnd());

  // Strip backticks from inline code
  html = html.replace(/`([^`]+)`/g, "$1");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="agent-link">$1</a>');

  // Bold + italic (***text*** or ___text___)
  html = html.replace(/\*{3}(.+?)\*{3}/g, "<strong><em>$1</em></strong>");
  html = html.replace(/_{3}(.+?)_{3}/g, "<strong><em>$1</em></strong>");

  // Bold (**text** or __text__)
  html = html.replace(/\*{2}(.+?)\*{2}/g, "<strong>$1</strong>");
  html = html.replace(/_{2}(.+?)_{2}/g, "<strong>$1</strong>");

  // Italic (*text* or _text_)
  html = html.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");

  // Strip heading markers (# ... ) — render as bold paragraph instead
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");

  // Process lines for lists
  const lines = html.split("\n");
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Numbered list (1. item)
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (olMatch) {
      if (!inOl) { result.push('<ol class="agent-ol">'); inOl = true; }
      if (inUl) { result.push("</ul>"); inUl = false; }
      result.push(`<li>${olMatch[2]}</li>`);
      continue;
    }

    // Bullet list (- item or * item)
    const ulMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (ulMatch) {
      if (!inUl) { result.push('<ul class="agent-ul">'); inUl = true; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<li>${ulMatch[1]}</li>`);
      continue;
    }

    // Close open lists
    if (inUl) { result.push("</ul>"); inUl = false; }
    if (inOl) { result.push("</ol>"); inOl = false; }

    // Horizontal rule
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      result.push('<hr class="agent-hr" />');
      continue;
    }

    // Empty line → paragraph break
    if (line.trim() === "") {
      result.push('<div class="h-2"></div>');
    } else {
      result.push(`<p class="agent-p">${line}</p>`);
    }
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  return result.join("");
}

interface ArticleRef {
  id: number;
  title: string;
  url: string;
  category: string | null;
  excerpt?: string;
}

interface TermRef {
  id: number;
  name: string;
  definition: string;
}

interface CorrectionProposal {
  qa_id: number;
  changes: {
    question?: string;
    answer?: string | null;
    resolution_steps?: string[];
    summary?: string;
    resolved?: boolean;
  };
  reasoning: string;
}

interface BehavioralSuggestion {
  action: "create" | "update";
  update_id?: number;
  scope: "global" | "category";
  category_name?: string;
  type: "knowledge" | "solution" | "general";
  title: string;
  instruction: string;
}

type CorrectionState = "idle" | "writing" | "loading" | "preview" | "applied";

interface RefSectionRef {
  id: number;
  doc_title: string;
  heading: string;
  excerpt: string;
  content: string;
}

interface VideoRef {
  id: number;
  title: string;
  loom_url: string;
  summary: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: QAItem[];
  articles?: ArticleRef[];
  terms?: TermRef[];
  refSections?: RefSectionRef[];
  videos?: VideoRef[];
  streaming?: boolean;
  messageId?: number | null;
  rating?: number | null;
}

interface PriorCorrection {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  user_feedback: string;
  created_at: number;
}

interface CorrectionData {
  state: CorrectionState;
  feedback: string;
  preview: CorrectionProposal[];
  behavioralSuggestion: BehavioralSuggestion | null;
  appliedCount: number;
  priorCorrections: Record<number, PriorCorrection[]>; // keyed by qa_id
}

interface ConversationItem {
  id: number;
  user_id: number;
  title: string | null;
  username: string;
  message_count: number;
  created_at: number;
  updated_at: number;
}

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  calendly_url: string | null;
  gmail_connected: boolean;
  gmail_email: string | null;
  role: "master" | "user";
}

export interface AgentPanelHandle {
  setInput: (text: string) => void;
  send: () => void;
}

const PALETTE = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-mint-100 text-mint-700",
];
const categoryColors: Record<string, string> = {};
let colorIdx = 0;
function getCategoryColor(name?: string | null) {
  if (!name) return "bg-slate-100 text-slate-600";
  if (!categoryColors[name]) categoryColors[name] = PALETTE[colorIdx++ % PALETTE.length];
  return categoryColors[name];
}

// ─── Star Rating ─────────────────────────────────────────────────────────

function StarRating({ messageId, initialRating }: { messageId: number | null | undefined; initialRating?: number | null }) {
  const [rating, setRating] = useState<number | null>(initialRating ?? null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRating(initialRating ?? null);
    setHovered(null);
    setShowFeedback(false);
    setFeedback("");
  }, [messageId, initialRating]);

  if (!messageId) return null;

  const saveRating = async (value: number, fb?: string) => {
    setSaving(true);
    try {
      await fetch(`/api/messages/${messageId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value, feedback: fb || null }),
      });
      setRating(value);
      setShowFeedback(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleClick = (value: number) => {
    if (value === 1) {
      setRating(value);
      setShowFeedback(true);
    } else {
      saveRating(value);
    }
  };

  const colors = ["", "text-red-400", "text-amber-400", "text-emerald-400"];
  const fillColors = ["", "fill-red-400 text-red-400", "fill-amber-400 text-amber-400", "fill-emerald-400 text-emerald-400"];

  return (
    <div>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3].map((v) => {
          const active = (hovered ?? rating ?? 0) >= v;
          return (
            <button
              key={v}
              onClick={() => handleClick(v)}
              onMouseEnter={() => setHovered(v)}
              onMouseLeave={() => setHovered(null)}
              disabled={saving}
              className="p-0.5 hover:scale-110 transition-transform disabled:opacity-50"
            >
              <Star
                size={14}
                className={active ? fillColors[hovered ?? rating ?? v] : "text-slate-300"}
              />
            </button>
          );
        })}
        {rating && (
          <span className={`ml-1 text-[10px] font-medium ${colors[rating]}`}>
            {rating === 1 ? "Bad" : rating === 2 ? "OK" : "Great"}
          </span>
        )}
      </div>
      {showFeedback && (
        <div className="mt-1.5 space-y-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What went wrong? This helps improve future answers."
            rows={2}
            className="w-full rounded-lg border border-red-200 bg-red-50/30 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-red-300"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => saveRating(1, feedback)}
              disabled={saving}
              className="rounded-md bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              Submit
            </button>
            <button
              onClick={() => { setShowFeedback(false); saveRating(1); }}
              className="rounded-md px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              Skip feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailDraftButton({ messageId }: { messageId: number | null | undefined }) {
  const [showModal, setShowModal] = useState(false);

  if (!messageId) return null;

  return (
    <>
      <button onClick={() => setShowModal(true)} className="flex items-center gap-1 rounded-md bg-mint-50 border border-mint-200 px-2 py-0.5 text-[11px] font-medium text-mint-700 hover:bg-mint-100 transition-colors">
        <Mail size={11} /><span>Email</span>
      </button>
      {showModal && <EmailDraftModal messageId={messageId} onClose={() => setShowModal(false)} />}
    </>
  );
}

// ─── Sub-components (unchanged) ──────────────────────────────────────────

function RefSectionCard({ section }: { section: RefSectionRef }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden text-xs">
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <BookOpen size={12} className="text-mint-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-medium text-slate-800">{section.heading}</span>
              <span className="text-slate-400 text-[10px]">{section.doc_title}</span>
            </div>
            {section.excerpt && (
              <p className="mt-1.5 text-slate-600 leading-relaxed border-l-2 border-mint-200 pl-2 italic">
                {section.excerpt}
              </p>
            )}
          </div>
        </div>
      </div>
      {section.content && (
        <>
          <button
            onClick={() => setExpanded((p) => !p)}
            className="w-full px-2.5 py-1 bg-slate-50 border-t border-slate-100 text-left text-[10px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            {expanded ? "Hide full section ↑" : "View full section ↓"}
          </button>
          {expanded && (
            <div className="px-2.5 py-2 border-t border-slate-100 bg-slate-50 max-h-48 overflow-y-auto">
              <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{section.content}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SourceCard({ qa }: { qa: QAItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden text-xs">
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 leading-snug line-clamp-2">{qa.question}</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {qa.category_name && (
                <span className={`px-1.5 py-0.5 rounded-full font-medium ${getCategoryColor(qa.category_name)}`}>
                  {qa.category_name}
                </span>
              )}
              <span className={`px-1.5 py-0.5 rounded-full font-medium ${qa.resolved ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {qa.resolved ? "Resolved" : "Unresolved"}
              </span>
            </div>
          </div>
        </div>
      </div>
      {qa.answer && (
        <>
          <button
            onClick={() => setExpanded((p) => !p)}
            className="w-full px-2.5 py-1.5 bg-slate-50 border-t border-slate-100 text-left text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {expanded ? "Hide answer ↑" : "View answer ↓"}
          </button>
          {expanded && (
            <div className="px-2.5 py-2 border-t border-slate-100 bg-slate-50">
              <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{qa.answer}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CorrectionPreviewCard({ proposal, sourceQA }: { proposal: CorrectionProposal; sourceQA?: QAItem }) {
  const fields = Object.entries(proposal.changes).filter(([, v]) => v !== undefined);
  return (
    <div className="border border-amber-200 rounded-lg bg-amber-50/50 p-3 text-xs space-y-2">
      <div className="font-medium text-slate-700">
        QA #{proposal.qa_id}: {sourceQA?.question ?? "Unknown"}
      </div>
      {fields.map(([field, newVal]) => {
        const oldVal = sourceQA ? (sourceQA as unknown as Record<string, unknown>)[field] : undefined;
        const oldStr = field === "resolution_steps"
          ? (() => { try { return JSON.parse(String(oldVal ?? "[]")).join(", "); } catch { return String(oldVal ?? ""); } })()
          : String(oldVal ?? "(empty)");
        const newStr = field === "resolution_steps" && Array.isArray(newVal) ? newVal.join(", ") : String(newVal ?? "(empty)");
        return (
          <div key={field} className="space-y-1">
            <span className="font-medium text-slate-500 uppercase tracking-wider text-[10px]">{field}</span>
            <div className="rounded bg-red-50 px-2 py-1 text-red-700 line-through">{oldStr}</div>
            <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{newStr}</div>
          </div>
        );
      })}
      {proposal.reasoning && <p className="text-slate-400 italic">{proposal.reasoning}</p>}
    </div>
  );
}

function CorrectionFlow({ msgIndex, message, corrections, onCorrectionsChange, userQuestion }: {
  msgIndex: number; message: Message; corrections: Record<number, CorrectionData>;
  onCorrectionsChange: (idx: number, data: CorrectionData) => void; userQuestion: string;
}) {
  const data = corrections[msgIndex] ?? { state: "idle" as CorrectionState, feedback: "", preview: [], behavioralSuggestion: null, appliedCount: 0, priorCorrections: {} };
  const setState = (partial: Partial<CorrectionData>) => onCorrectionsChange(msgIndex, { ...data, ...partial });

  const handleGeneratePreview = async () => {
    if (!data.feedback.trim()) return;
    setState({ state: "loading" });
    try {
      const sourceIds = (message.sources ?? []).map((s) => s.id);
      const res = await fetch("/api/agent/correct", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentQuestion: userQuestion, agentAnswer: message.content, feedback: data.feedback, sourceIds }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      setState({
        state: "preview",
        preview: result.corrections ?? [],
        behavioralSuggestion: result.behavioral_suggestion ?? null,
        priorCorrections: result.priorCorrections ?? {},
      });
    } catch { setState({ state: "writing" }); }
  };

  const handleApply = async (includeBehavioral = false) => {
    setState({ state: "loading" });
    try {
      const res = await fetch("/api/agent/correct/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentQuestion: userQuestion,
          agentAnswer: message.content,
          feedback: data.feedback,
          corrections: data.preview,
          behavioralSuggestion: includeBehavioral ? data.behavioralSuggestion : null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      setState({
        state: "applied",
        appliedCount: result.updated?.length ?? 0,
        behavioralSuggestion: includeBehavioral ? null : data.behavioralSuggestion,
      });
    } catch { setState({ state: "preview" }); }
  };

  const handleCreateBehavioralCard = async () => {
    if (!data.behavioralSuggestion) return;
    const s = data.behavioralSuggestion;
    if (s.action === "update" && s.update_id) {
      await fetch(`/api/behavioral-cards/${s.update_id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: s.title, instruction: s.instruction, type: s.type, scope: s.scope }),
      });
    } else {
      await fetch("/api/behavioral-cards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: s.title, instruction: s.instruction, type: s.type, scope: s.scope, source: "correction" }),
      });
    }
    setState({ behavioralSuggestion: null });
  };

  const wasCorrected = data.state === "applied" || data.appliedCount > 0;

  return (
    <div className="w-full">
      {data.state === "idle" && (
        <div className="flex items-center gap-3 mt-1">
          <button onClick={() => setState({ state: "writing" })} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-600 transition-colors">
            <Flag size={11} /><span>{wasCorrected ? "Re-correct this response" : "Correct this response"}</span>
          </button>
          {wasCorrected && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 bg-emerald-50 rounded-full px-2 py-0.5">
              <Check size={9} />Previously corrected
            </span>
          )}
        </div>
      )}
      {data.state === "writing" && (
        <div className="mt-2 space-y-2 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <textarea value={data.feedback} onChange={(e) => setState({ feedback: e.target.value })} placeholder="What's wrong or needs changing?" rows={3}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <div className="flex gap-2">
            <button onClick={handleGeneratePreview} disabled={!data.feedback.trim()} className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">
              <Sparkles className="h-3 w-3" />Generate Preview
            </button>
            <button onClick={() => setState({ state: "idle", feedback: "" })} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}
      {data.state === "loading" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <Loader2 size={12} className="animate-spin" /><span>Analyzing feedback...</span>
        </div>
      )}
      {data.state === "preview" && (
        <div className="mt-2 space-y-3 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <div className="text-xs font-medium text-slate-600">Proposed corrections ({data.preview.length} card{data.preview.length !== 1 ? "s" : ""}):</div>
          {data.preview.length === 0 && <p className="text-xs text-slate-400">No content changes needed.</p>}
          {data.preview.map((p) => {
            const priors = data.priorCorrections[p.qa_id] ?? [];
            return (
              <div key={p.qa_id}>
                {priors.length > 0 && (
                  <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 text-[11px]">
                    <div className="font-medium text-blue-600 mb-1">Prior corrections on this card:</div>
                    {priors.map((pc) => (
                      <div key={pc.id} className="flex gap-1 text-blue-500 mb-0.5">
                        <span className="font-medium">{pc.field_name}:</span>
                        <span className="line-through text-blue-300">{pc.old_value?.substring(0, 60) ?? "(empty)"}</span>
                        <span>→</span>
                        <span>{pc.new_value?.substring(0, 60) ?? "(empty)"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <CorrectionPreviewCard proposal={p} sourceQA={message.sources?.find((s) => s.id === p.qa_id)} />
              </div>
            );
          })}
          {data.behavioralSuggestion && (
            <div className="border border-mint-200 rounded-lg bg-mint-50/50 p-3 text-xs space-y-2">
              <div className="font-medium text-mint-700 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                {data.behavioralSuggestion.action === "update" ? "Update existing rule" : "Suggested behavioral rule"}
                {data.behavioralSuggestion.action === "update" && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">update</span>
                )}
              </div>
              <p className="text-slate-700"><span className="font-medium">{data.behavioralSuggestion.title}:</span> {data.behavioralSuggestion.instruction}</p>
              <button onClick={handleCreateBehavioralCard} className="flex items-center gap-1 rounded-lg bg-mint-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-mint-700">
                {data.behavioralSuggestion.action === "update" ? "Update Rule" : "Create Rule"}
              </button>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {data.preview.length > 0 && (
              <>
                <button onClick={() => handleApply(false)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"><Check className="h-3 w-3" />Apply</button>
                {data.behavioralSuggestion && (
                  <button onClick={() => handleApply(true)} className="flex items-center gap-1 rounded-lg bg-mint-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-700">
                    <Sparkles className="h-3 w-3" />{data.behavioralSuggestion?.action === "update" ? "Apply + Update Rule" : "Apply + Create Rule"}
                  </button>
                )}
              </>
            )}
            <button onClick={() => setState({ state: "idle", feedback: "", preview: [], behavioralSuggestion: null, priorCorrections: {} })} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">Discard</button>
          </div>
        </div>
      )}
      {data.state === "applied" && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600"><Check size={12} /><span>{data.appliedCount} QA card{data.appliedCount !== 1 ? "s" : ""} updated</span></div>
          {data.behavioralSuggestion && (
            <div className="border border-mint-200 rounded-lg bg-mint-50/50 p-3 text-xs space-y-2">
              <div className="font-medium text-mint-700 flex items-center gap-1.5"><Sparkles className="h-3 w-3" />Suggested behavioral rule (not yet created)</div>
              <p className="text-slate-700"><span className="font-medium">{data.behavioralSuggestion.title}:</span> {data.behavioralSuggestion.instruction}</p>
              <button onClick={handleCreateBehavioralCard} className="flex items-center gap-1 rounded-lg bg-mint-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-mint-700">Create Rule</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────

export const AgentPanel = forwardRef<AgentPanelHandle, { user: AuthUser | null }>(function AgentPanel({ user }, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [corrections, setCorrections] = useState<Record<number, CorrectionData>>({});
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarFilter, setSidebarFilter] = useState<"mine" | "all">("mine");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [expandedRefs, setExpandedRefs] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const url = sidebarFilter === "mine" && user ? `/api/conversations?userId=${user.id}` : "/api/conversations";
      const res = await fetch(url);
      if (res.ok) setConversations(await res.json());
    } catch { /* ignore */ }
  }, [sidebarFilter, user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for external "load-conversation" events (e.g. from ratings history)
  useEffect(() => {
    const handler = (e: Event) => {
      const convId = (e as CustomEvent).detail?.conversationId;
      if (convId) loadConversation(convId);
    };
    window.addEventListener("load-conversation", handler);
    return () => window.removeEventListener("load-conversation", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConversation = async (convId: number) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversationId(convId);
      setCorrections({});
      setPdfFile(null);

      const loaded: Message[] = data.messages.map((m: { id: number; role: "user" | "assistant"; content: string; sources_json: string | null }) => {
        const msg: Message = { role: m.role, content: m.content, messageId: m.id };
        if (m.sources_json) {
          try {
            const parsed = JSON.parse(m.sources_json);
            msg.sources = parsed.sources;
            msg.articles = parsed.articles;
            msg.terms = parsed.terms;
            msg.refSections = parsed.refSections;
            msg.videos = parsed.videos;
          } catch { /* ignore */ }
        }
        // Attach saved rating
        if (m.role === "assistant" && data.ratings?.[m.id]) {
          msg.rating = data.ratings[m.id].rating;
        }
        return msg;
      });
      setMessages(loaded);
    } catch { /* ignore */ }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setCorrections({});
    setPdfFile(null);
    inputRef.current?.focus();
  };

  const deleteConversation = async (convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
    if (conversationId === convId) startNewChat();
    loadConversations();
  };

  const handleCorrectionChange = (idx: number, data: CorrectionData) => {
    setCorrections((prev) => ({ ...prev, [idx]: data }));
  };

  const getUserQuestion = (assistantIdx: number): string => {
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const attachedPdf = pdfFile;
    setPdfFile(null);
    setLoading(true);

    const displayContent = attachedPdf ? `${question}\n📎 ${attachedPdf.name}` : question;
    const userMessage: Message = { role: "user", content: displayContent };
    setMessages((prev) => [...prev, userMessage]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      let res: Response;
      if (attachedPdf) {
        const formData = new FormData();
        formData.append("question", question);
        formData.append("history", JSON.stringify(history));
        if (conversationId) formData.append("conversationId", String(conversationId));
        formData.append("pdf", attachedPdf);
        res = await fetch("/api/agent/chat", { method: "POST", body: formData });
      } else {
        res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, conversationId }),
        });
      }

      if (!res.ok || !res.body) throw new Error("Failed to connect to agent");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "delta") {
              streamedText += event.text;
              const visible = streamedText
                .replace(/\n?SOURCES:\s*\[[^\]]*\]?\s*/gm, "")
                .replace(/\n?REFS:\s*\[[^\]]*\]?\s*/gm, "")
                .replace(/\n?ARTICLES:\s*\[[^\]]*\]?\s*/gm, "")
                .replace(/\n?VIDEOS:\s*\[[^\]]*\]?\s*/gm, "");
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: visible, streaming: true },
              ]);
            } else if (event.type === "done") {
              // Update conversation ID for new conversations
              if (event.conversationId && !conversationId) {
                setConversationId(event.conversationId);
                loadConversations();
              }
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content: event.answer,
                  sources: event.sources ?? [],
                  articles: event.articles ?? [],
                  terms: event.terms ?? [],
                  refSections: event.refSections ?? [],
                  videos: event.videos ?? [],
                  streaming: false,
                  messageId: event.messageId ?? null,
                },
              ]);
            } else if (event.type === "error") {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: `Error: ${event.message}`, streaming: false },
              ]);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `Connection error: ${err}`, streaming: false },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  useImperativeHandle(ref, () => ({
    setInput: (text: string) => setInput(text),
    send: () => send(),
  }), [send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex h-[calc(100vh-10rem)] max-h-[800px]">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-64" : "w-0"} transition-all duration-200 overflow-hidden flex-shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col`}>
        <div className="p-3 border-b border-slate-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-mint-600 px-3 py-2 text-xs font-medium text-white hover:bg-mint-700 transition-colors"
          >
            <Plus size={14} />New Chat
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setSidebarFilter("mine")}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarFilter === "mine" ? "text-mint-600 border-b-2 border-mint-600" : "text-slate-400 hover:text-slate-600"}`}
          >
            My Chats
          </button>
          <button
            onClick={() => setSidebarFilter("all")}
            className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1 ${sidebarFilter === "all" ? "text-mint-600 border-b-2 border-mint-600" : "text-slate-400 hover:text-slate-600"}`}
          >
            <Users size={11} />All
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No conversations yet</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => loadConversation(c.id)}
                className={`group px-3 py-2.5 border-b border-slate-100 cursor-pointer hover:bg-white transition-colors ${conversationId === c.id ? "bg-white border-l-2 border-l-mint-500" : ""}`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <MessageSquare size={11} className="text-slate-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-slate-700 truncate">{c.title || "Untitled"}</span>
                  </div>
                  {(user?.role === "master" || c.user_id === user?.id) && (
                    <button
                      onClick={(e) => deleteConversation(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {sidebarFilter === "all" && c.username !== user?.username && (
                    <span className="text-[10px] text-mint-500 font-medium">{c.username}</span>
                  )}
                  <span className="text-[10px] text-slate-400">{c.message_count} msgs</span>
                  <span className="text-[10px] text-slate-400">{new Date(c.updated_at * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setSidebarOpen((p) => !p)}
        className="flex items-center justify-center w-5 bg-slate-100 hover:bg-slate-200 border-r border-slate-200 transition-colors flex-shrink-0"
      >
        {sidebarOpen ? <ChevronLeft size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
      </button>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div data-tour="agent-messages" className="flex-1 overflow-y-auto space-y-6 px-4 pb-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-mint-50 flex items-center justify-center">
                <Bot size={28} className="text-mint-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Ask anything about your customers</p>
                <p className="text-xs mt-1">Answers are grounded in support tickets, documentation, and glossary terms</p>
              </div>
              <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-lg">
                {[
                  "Which assessments do you recommend for measuring problem-solving skills and customer service abilities?",
                  "How do I set up automated candidate screening for a high-volume role?",
                  "What's the best way to share assessment results with my hiring team?",
                  "Can you walk me through configuring webhooks for our ATS integration?",
                ].map((q) => (
                  <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-mint-300 hover:bg-mint-50 text-xs text-slate-600 transition-all">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-lg bg-mint-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={14} className="text-mint-600" />
                  </div>
                )}

                <div className={`max-w-[80%] space-y-3 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                  <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user" ? "bg-mint-600 text-white rounded-tr-sm whitespace-pre-wrap" : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm agent-markdown"
                  }`}>
                    {msg.role === "assistant" && msg.content ? (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                    ) : (
                      msg.content || (msg.streaming && (
                        <span className="inline-flex gap-1 items-center text-slate-400"><Loader2 size={12} className="animate-spin" />Thinking...</span>
                      ))
                    )}
                    {msg.streaming && msg.content && <span className="inline-block w-0.5 h-4 bg-mint-400 animate-pulse ml-0.5 align-middle" />}
                  </div>

                  {/* Action bar: Stars | References toggle | Actions menu */}
                  {!msg.streaming && msg.role === "assistant" && msg.content && !msg.content.startsWith("Error:") && !msg.content.startsWith("Connection error:") && (() => {
                    const refCount = (msg.sources?.length ?? 0) + (msg.articles?.length ?? 0) + (msg.terms?.length ?? 0) + (msg.refSections?.length ?? 0) + (msg.videos?.length ?? 0);
                    const refsExpanded = expandedRefs[i] ?? false;

                    return (
                      <div className="w-full space-y-2">
                        {/* Compact action bar */}
                        <div className="flex items-center gap-3">
                          <StarRating messageId={msg.messageId} initialRating={msg.rating} />

                          {/* References toggle */}
                          {refCount > 0 ? (
                            <button
                              onClick={() => setExpandedRefs((prev) => ({ ...prev, [i]: !prev[i] }))}
                              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              <BookOpen size={11} />
                              <span className="text-[11px]">{refCount} ref{refCount !== 1 ? "s" : ""}</span>
                              <ChevronDown size={10} className={`transition-transform ${refsExpanded ? "rotate-180" : ""}`} />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 text-[11px] text-amber-500">
                              <AlertCircle size={11} /><span>No refs</span>
                            </div>
                          )}

                          {/* Inline actions */}
                          <div className="flex items-center gap-2 ml-auto">
                            <EmailDraftButton messageId={msg.messageId} />
                            {(() => {
                              const corrData = corrections[i];
                              const wasCorrected = corrData && (corrData.state === "applied" || corrData.appliedCount > 0);
                              return (
                                <button
                                  onClick={() => {
                                    handleCorrectionChange(i, { ...(corrData ?? { state: "idle" as const, feedback: "", preview: [], behavioralSuggestion: null, appliedCount: 0, priorCorrections: {} }), state: "writing" });
                                  }}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-600 transition-colors"
                                >
                                  <Flag size={11} />
                                  <span>{wasCorrected ? "Re-correct" : "Correct"}</span>
                                  {wasCorrected && <Check size={9} className="text-emerald-500" />}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Collapsible references panel */}
                        {refsExpanded && (
                          <div className="space-y-3 pt-1 border-t border-slate-100">
                            {/* Sources */}
                            {msg.sources && msg.sources.length > 0 && (
                              <div className="w-full">
                                <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                                  <BookOpen size={11} /><span>{msg.sources.length} Q&A source{msg.sources.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {msg.sources.map((qa) => <SourceCard key={qa.id} qa={qa} />)}
                                </div>
                              </div>
                            )}

                            {/* Articles */}
                            {msg.articles && msg.articles.length > 0 && (
                              <div className="w-full">
                                <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                                  <Globe size={11} /><span>{msg.articles.length} article{msg.articles.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1.5">
                                  {msg.articles.map((a) => (
                                    <div key={a.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden text-xs">
                                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 hover:bg-cyan-50 transition-colors">
                                        <Globe size={12} className="text-cyan-500 flex-shrink-0" />
                                        <span className="text-slate-800 font-medium truncate">{a.title}</span>
                                        {a.category && <span className="ml-auto px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-medium flex-shrink-0">{a.category}</span>}
                                      </a>
                                      {a.excerpt && (
                                        <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
                                          <p className="text-slate-600 leading-relaxed border-l-2 border-cyan-200 pl-2 italic">{a.excerpt}</p>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Glossary terms */}
                            {msg.terms && msg.terms.length > 0 && (
                              <div className="w-full">
                                <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400"><Tag size={11} /><span>Glossary terms</span></div>
                                <div className="flex flex-wrap gap-1.5">
                                  {msg.terms.map((t) => (
                                    <span key={t.id} title={t.definition} className="px-2 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-medium cursor-default">{t.name}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Ref sections */}
                            {msg.refSections && msg.refSections.length > 0 && (
                              <div className="w-full">
                                <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                                  <BookOpen size={11} /><span>{msg.refSections.length} reference section{msg.refSections.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {msg.refSections.map((r) => <RefSectionCard key={r.id} section={r} />)}
                                </div>
                              </div>
                            )}

                            {/* Video walkthroughs */}
                            {msg.videos && msg.videos.length > 0 && (
                              <div className="w-full">
                                <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                                  <span>{msg.videos.length} video walkthrough{msg.videos.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1.5">
                                  {msg.videos.map((v) => (
                                    <a key={v.id} href={v.loom_url} target="_blank" rel="noopener noreferrer"
                                      className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-mint-50/50 hover:border-mint-200 transition-colors text-xs group">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5 text-slate-400 group-hover:text-mint-500">
                                        <polygon points="5 3 19 12 5 21 5 3"/>
                                      </svg>
                                      <div className="min-w-0">
                                        <p className="font-medium text-slate-700 group-hover:text-mint-700 truncate">{v.title}</p>
                                        <p className="text-slate-400 line-clamp-1 mt-0.5">{v.summary}</p>
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Correction flow (renders inline when triggered from actions menu) */}
                  {!msg.streaming && msg.role === "assistant" && msg.content && corrections[i]?.state && corrections[i].state !== "idle" && (
                    <CorrectionFlow msgIndex={i} message={msg} corrections={corrections} onCorrectionsChange={handleCorrectionChange} userQuestion={getUserQuestion(i)} />
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User size={14} className="text-slate-600" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Attached file indicator */}
        {pdfFile && (
          <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-mint-50 border border-mint-200 text-xs text-mint-700">
            <Paperclip size={11} />
            <span className="truncate flex-1">{pdfFile.name}</span>
            <button onClick={() => setPdfFile(null)} className="text-mint-400 hover:text-red-500 font-bold">&times;</button>
          </div>
        )}

        {/* Input */}
        <form data-tour="agent-input" onSubmit={send} className="mx-4 mt-3 flex items-end rounded-xl border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-mint-500 focus-within:border-transparent transition">
          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && file.size <= 10 * 1024 * 1024) { setPdfFile(file); }
              else if (file) { alert("Please select a PDF file under 10MB."); }
              e.target.value = "";
            }}
          />
          {/* Attach button */}
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading}
            className="flex-shrink-0 m-1.5 w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all disabled:opacity-40"
            title="Attach PDF assessment report">
            <Paperclip size={14} />
          </button>
          <textarea
            ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Ask a question about your customers..." rows={1} disabled={loading}
            className="flex-1 resize-none pr-2 py-2.5 bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none disabled:opacity-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 120)}px`; }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="flex-shrink-0 m-1.5 w-8 h-8 rounded-lg bg-mint-600 hover:bg-mint-700 text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
});
