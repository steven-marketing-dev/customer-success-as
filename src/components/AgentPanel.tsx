"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Bot, User, Loader2, BookOpen, AlertCircle, Globe, Tag, Flag, Check, Sparkles } from "lucide-react";
import { type QAItem } from "./QACard";

interface ArticleRef {
  id: number;
  title: string;
  url: string;
  category: string | null;
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
  content: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: QAItem[];
  articles?: ArticleRef[];
  terms?: TermRef[];
  refSections?: RefSectionRef[];
  streaming?: boolean;
}

// Per-message correction state stored separately to avoid re-renders on all messages
interface CorrectionData {
  state: CorrectionState;
  feedback: string;
  preview: CorrectionProposal[];
  behavioralSuggestion: BehavioralSuggestion | null;
  appliedCount: number;
}

const PALETTE = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
];
const categoryColors: Record<string, string> = {};
let colorIdx = 0;
function getCategoryColor(name?: string | null) {
  if (!name) return "bg-slate-100 text-slate-600";
  if (!categoryColors[name]) categoryColors[name] = PALETTE[colorIdx++ % PALETTE.length];
  return categoryColors[name];
}

function RefSectionCard({ section }: { section: RefSectionRef }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden text-xs">
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <BookOpen size={12} className="text-indigo-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-medium text-slate-800">{section.heading}</span>
            <span className="text-slate-400 ml-1.5">{section.doc_title}</span>
          </div>
        </div>
      </div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full px-2.5 py-1.5 bg-slate-50 border-t border-slate-100 text-left text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        {expanded ? "Hide content ↑" : "View content ↓"}
      </button>
      {expanded && (
        <div className="px-2.5 py-2 border-t border-slate-100 bg-slate-50">
          <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{section.content}</p>
        </div>
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

function CorrectionPreviewCard({
  proposal,
  sourceQA,
}: {
  proposal: CorrectionProposal;
  sourceQA?: QAItem;
}) {
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
        const newStr = field === "resolution_steps" && Array.isArray(newVal)
          ? newVal.join(", ")
          : String(newVal ?? "(empty)");

        return (
          <div key={field} className="space-y-1">
            <span className="font-medium text-slate-500 uppercase tracking-wider text-[10px]">{field}</span>
            <div className="rounded bg-red-50 px-2 py-1 text-red-700 line-through">{oldStr}</div>
            <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{newStr}</div>
          </div>
        );
      })}
      {proposal.reasoning && (
        <p className="text-slate-400 italic">{proposal.reasoning}</p>
      )}
    </div>
  );
}

function CorrectionFlow({
  msgIndex,
  message,
  corrections,
  onCorrectionsChange,
  userQuestion,
}: {
  msgIndex: number;
  message: Message;
  corrections: Record<number, CorrectionData>;
  onCorrectionsChange: (idx: number, data: CorrectionData) => void;
  userQuestion: string;
}) {
  const data = corrections[msgIndex] ?? {
    state: "idle" as CorrectionState,
    feedback: "",
    preview: [],
    behavioralSuggestion: null,
    appliedCount: 0,
  };

  const setState = (partial: Partial<CorrectionData>) => {
    onCorrectionsChange(msgIndex, { ...data, ...partial });
  };

  const handleGeneratePreview = async () => {
    if (!data.feedback.trim()) return;
    setState({ state: "loading" });

    try {
      const res = await fetch("/api/agent/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentQuestion: userQuestion,
          agentAnswer: message.content,
          feedback: data.feedback,
          sourceIds: (message.sources ?? []).map((s) => s.id),
        }),
      });

      if (!res.ok) throw new Error("Failed to generate preview");
      const result = await res.json();

      setState({
        state: "preview",
        preview: result.corrections ?? [],
        behavioralSuggestion: result.behavioral_suggestion ?? null,
      });
    } catch {
      setState({ state: "writing" });
    }
  };

  const handleApply = async () => {
    setState({ state: "loading" });

    try {
      const res = await fetch("/api/agent/correct/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentQuestion: userQuestion,
          agentAnswer: message.content,
          feedback: data.feedback,
          corrections: data.preview,
        }),
      });

      if (!res.ok) throw new Error("Failed to apply corrections");
      const result = await res.json();

      setState({ state: "applied", appliedCount: result.updated?.length ?? 0 });
    } catch {
      setState({ state: "preview" });
    }
  };

  const handleCreateBehavioralCard = async () => {
    if (!data.behavioralSuggestion) return;
    const s = data.behavioralSuggestion;

    await fetch("/api/behavioral-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: s.title,
        instruction: s.instruction,
        type: s.type,
        scope: s.scope,
        source: "suggested",
      }),
    });

    setState({ behavioralSuggestion: null });
  };

  if (!message.sources || message.sources.length === 0) return null;

  return (
    <div className="w-full">
      {data.state === "idle" && (
        <button
          onClick={() => setState({ state: "writing" })}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-600 transition-colors mt-1"
        >
          <Flag size={11} />
          <span>Correct this response</span>
        </button>
      )}

      {data.state === "writing" && (
        <div className="mt-2 space-y-2 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <textarea
            value={data.feedback}
            onChange={(e) => setState({ feedback: e.target.value })}
            placeholder="What's wrong or needs changing? (e.g., 'The steps are outdated, the new flow uses Settings > Security')"
            rows={3}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button
              onClick={handleGeneratePreview}
              disabled={!data.feedback.trim()}
              className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              Generate Preview
            </button>
            <button
              onClick={() => setState({ state: "idle", feedback: "" })}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {data.state === "loading" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <Loader2 size={12} className="animate-spin" />
          <span>Analyzing feedback and generating corrections...</span>
        </div>
      )}

      {data.state === "preview" && (
        <div className="mt-2 space-y-3 border border-amber-200 rounded-lg bg-amber-50/30 p-3">
          <div className="text-xs font-medium text-slate-600">
            Proposed corrections ({data.preview.length} card{data.preview.length !== 1 ? "s" : ""}):
          </div>

          {data.preview.length === 0 && (
            <p className="text-xs text-slate-400">No content changes needed for the source cards.</p>
          )}

          {data.preview.map((proposal) => (
            <CorrectionPreviewCard
              key={proposal.qa_id}
              proposal={proposal}
              sourceQA={message.sources?.find((s) => s.id === proposal.qa_id)}
            />
          ))}

          {data.behavioralSuggestion && (
            <div className="border border-indigo-200 rounded-lg bg-indigo-50/50 p-3 text-xs space-y-2">
              <div className="font-medium text-indigo-700 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                Suggested behavioral rule
              </div>
              <p className="text-slate-700">
                <span className="font-medium">{data.behavioralSuggestion.title}:</span>{" "}
                {data.behavioralSuggestion.instruction}
              </p>
              <div className="flex gap-1.5">
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-medium">
                  {data.behavioralSuggestion.scope}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">
                  {data.behavioralSuggestion.type}
                </span>
              </div>
              <button
                onClick={handleCreateBehavioralCard}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Create Rule
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {data.preview.length > 0 && (
              <button
                onClick={handleApply}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                <Check className="h-3 w-3" />
                Apply Corrections
              </button>
            )}
            <button
              onClick={() => setState({ state: "idle", feedback: "", preview: [], behavioralSuggestion: null })}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {data.state === "applied" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600">
          <Check size={12} />
          <span>{data.appliedCount} QA card{data.appliedCount !== 1 ? "s" : ""} updated</span>
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [corrections, setCorrections] = useState<Record<number, CorrectionData>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCorrectionChange = (idx: number, data: CorrectionData) => {
    setCorrections((prev) => ({ ...prev, [idx]: data }));
  };

  // Find the user question that preceded a given assistant message
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
    setLoading(true);

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);

    // Add placeholder assistant message
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", streaming: true },
    ]);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });

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
              // Strip any partial SOURCES/REFS lines from display
              const visible = streamedText
                .replace(/\n?SOURCES:\[[^\]]*\]?\s*/m, "")
                .replace(/\n?REFS:\[[^\]]*\]?\s*/m, "");
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: visible, streaming: true },
              ]);
            } else if (event.type === "done") {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  role: "assistant",
                  content: event.answer,
                  sources: event.sources ?? [],
                  articles: event.articles ?? [],
                  terms: event.terms ?? [],
                  refSections: event.refSections ?? [],
                  streaming: false,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] max-h-[800px]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Bot size={28} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">Ask anything about your customers</p>
              <p className="text-xs mt-1">Answers are grounded in support tickets, documentation articles, and glossary terms</p>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-lg">
              {[
                "Which assessments do you recommend for measuring problem-solving skills and customer service abilities?",
                "How do I set up automated candidate screening for a high-volume role?",
                "What's the best way to share assessment results with my hiring team?",
                "Can you walk me through configuring webhooks for our ATS integration?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 text-xs text-slate-600 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot size={14} className="text-indigo-600" />
                </div>
              )}

              <div className={`max-w-[80%] space-y-3 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"
                  }`}
                >
                  {msg.content || (msg.streaming && (
                    <span className="inline-flex gap-1 items-center text-slate-400">
                      <Loader2 size={12} className="animate-spin" />
                      Thinking...
                    </span>
                  ))}
                  {msg.streaming && msg.content && (
                    <span className="inline-block w-0.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>

                {/* Sources */}
                {!msg.streaming && msg.sources && msg.sources.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                      <BookOpen size={11} />
                      <span>{msg.sources.length} Q&A source{msg.sources.length !== 1 ? "s" : ""} from support tickets</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {msg.sources.map((qa) => (
                        <SourceCard key={qa.id} qa={qa} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Article references */}
                {!msg.streaming && msg.articles && msg.articles.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                      <Globe size={11} />
                      <span>{msg.articles.length} article{msg.articles.length !== 1 ? "s" : ""} from documentation</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {msg.articles.map((a) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs hover:border-cyan-300 hover:bg-cyan-50 transition-colors"
                        >
                          <Globe size={12} className="text-cyan-500 flex-shrink-0" />
                          <span className="text-slate-800 font-medium truncate">{a.title}</span>
                          {a.category && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-medium flex-shrink-0">
                              {a.category}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Glossary terms used */}
                {!msg.streaming && msg.terms && msg.terms.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                      <Tag size={11} />
                      <span>Glossary terms referenced</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.terms.map((t) => (
                        <span
                          key={t.id}
                          title={t.definition}
                          className="px-2 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-medium cursor-default"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reference document sections cited */}
                {!msg.streaming && msg.refSections && msg.refSections.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
                      <BookOpen size={11} />
                      <span>{msg.refSections.length} reference section{msg.refSections.length !== 1 ? "s" : ""} from documents</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {msg.refSections.map((r) => (
                        <RefSectionCard key={r.id} section={r} />
                      ))}
                    </div>
                  </div>
                )}

                {!msg.streaming && (!msg.sources || msg.sources.length === 0) && (!msg.articles || msg.articles.length === 0) && (!msg.refSections || msg.refSections.length === 0) && msg.role === "assistant" && msg.content && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-500">
                    <AlertCircle size={11} />
                    <span>No matching entries found in knowledge base</span>
                  </div>
                )}

                {/* Correction flow */}
                {!msg.streaming && msg.role === "assistant" && msg.content && (
                  <CorrectionFlow
                    msgIndex={i}
                    message={msg}
                    corrections={corrections}
                    onCorrectionsChange={handleCorrectionChange}
                    userQuestion={getUserQuestion(i)}
                  />
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

      {/* Input */}
      <form onSubmit={send} className="mt-3 flex items-end rounded-xl border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your customers..."
          rows={1}
          disabled={loading}
          className="flex-1 resize-none pl-4 pr-2 py-2.5 bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none disabled:opacity-50"
          style={{ maxHeight: "120px", overflowY: "auto" }}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = "auto";
            t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex-shrink-0 m-1.5 w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
      <p className="text-center text-xs text-slate-400 mt-1.5">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
