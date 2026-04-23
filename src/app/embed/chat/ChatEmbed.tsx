"use client";

import { useState, useRef, useEffect, useCallback, useMemo, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Send, Loader2, X, Star, ExternalLink, HelpCircle, MessageSquare, Mail, Calendar,
  ChevronLeft, ChevronRight, Check,
} from "lucide-react";
import { renderMarkdown } from "@/lib/markdown-inline";

interface ArticleRef {
  id: number;
  title: string;
  url: string;
  category: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  articles?: ArticleRef[];
  exchangeId?: string;
  streaming?: boolean;
  rating?: number | null;
}

interface WidgetConfig {
  productName: string | null;
  primaryColor: string | null;
  calendlyUrl: string | null;
  enableChat: boolean;
  enableEmail: boolean;
  enableCalendly: boolean;
}

type View = "menu" | "chat" | "email";

const DEFAULT_COLOR = "#0d9488";

function postToParent(payload: Record<string, unknown>) {
  try { window.parent?.postMessage({ source: "cs-widget", ...payload }, "*"); } catch { /* */ }
}

export function ChatEmbed() {
  const searchParams = useSearchParams();
  const widgetKey = searchParams.get("key") ?? "";

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("menu");

  // Fetch widget config (product name, primary color, toggles)
  useEffect(() => {
    if (!widgetKey) { setLoadError("Missing widget key"); return; }
    fetch(`/api/widget/config?key=${encodeURIComponent(widgetKey)}`)
      .then(async (r) => {
        if (!r.ok) { setLoadError("Unable to load widget configuration"); return; }
        const cfg = await r.json() as WidgetConfig;
        setConfig(cfg);

        // If only one option is enabled, skip the menu
        const enabledCount = Number(cfg.enableChat) + Number(cfg.enableEmail) + Number(cfg.enableCalendly);
        if (enabledCount === 1) {
          if (cfg.enableChat) setView("chat");
          else if (cfg.enableEmail) setView("email");
          // Calendly-only: menu still shown so the user can click it (opens new tab)
        }
      })
      .catch(() => setLoadError("Unable to load widget configuration"));
  }, [widgetKey]);

  const color = config?.primaryColor || DEFAULT_COLOR;
  const productName = config?.productName || "Help";

  if (loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white text-sm text-slate-500 p-6 text-center">
        {loadError}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white">
        <Loader2 size={18} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const canGoBack = view !== "menu" && (
    Number(config.enableChat) + Number(config.enableEmail) + Number(config.enableCalendly) > 1
  );

  return (
    <div className="h-full w-full flex flex-col bg-white">
      <WidgetHeader
        color={color}
        productName={productName}
        title={view === "menu" ? productName : view === "chat" ? "Chat Support" : "Email Support"}
        canGoBack={canGoBack}
        onBack={() => setView("menu")}
        onClose={() => postToParent({ type: "cs-widget-close" })}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        {view === "menu" && (
          <MenuView config={config} color={color} onPick={(v) => {
            if (v === "calendly" && config.calendlyUrl) {
              window.open(config.calendlyUrl, "_blank", "noopener,noreferrer");
              return;
            }
            setView(v as View);
          }} />
        )}
        {view === "chat" && <ChatView widgetKey={widgetKey} color={color} productName={productName} />}
        {view === "email" && <EmailView widgetKey={widgetKey} color={color} onSent={() => setView("menu")} />}
      </div>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function WidgetHeader({ color, productName, title, canGoBack, onBack, onClose }: {
  color: string; productName: string; title: string;
  canGoBack: boolean; onBack: () => void; onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0" style={{ backgroundColor: color, color: "white" }}>
      <div className="flex items-center gap-1.5 min-w-0">
        {canGoBack ? (
          <button onClick={onBack} className="flex items-center gap-1 px-1.5 py-0.5 -ml-1 rounded hover:bg-white/10 text-sm font-medium">
            <ChevronLeft size={16} />
            <span>Back</span>
          </button>
        ) : (
          <>
            <HelpCircle size={18} className="flex-shrink-0" />
            <span className="font-semibold text-sm truncate ml-1">{productName}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        {canGoBack && <span className="text-sm font-semibold opacity-90 mr-1">{title}</span>}
        <button onClick={onClose} title="Close" className="p-1 rounded hover:bg-white/10">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Menu View ──────────────────────────────────────────────────────────────

function MenuView({ config, color, onPick }: {
  config: WidgetConfig; color: string; onPick: (v: "chat" | "email" | "calendly") => void;
}) {
  const productName = config.productName || "Help";
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Hi, how can we help?</h2>
      <div className="space-y-2">
        {config.enableChat && (
          <MenuRow
            color={color}
            icon={<MessageSquare size={18} />}
            title="Chat Support"
            subtitle={`Ask anything about ${productName}. Instant answers from our help center.`}
            onClick={() => onPick("chat")}
          />
        )}
        {config.enableEmail && (
          <MenuRow
            color={color}
            icon={<Mail size={18} />}
            title="Email Support"
            subtitle="Send us a detailed message. We'll reply within one business day."
            onClick={() => onPick("email")}
          />
        )}
        {config.enableCalendly && config.calendlyUrl && (
          <MenuRow
            color={color}
            icon={<Calendar size={18} />}
            title="Schedule a Meeting"
            subtitle="Book a call with our team at a time that works for you."
            external
            onClick={() => onPick("calendly")}
          />
        )}
        {!config.enableChat && !config.enableEmail && !config.enableCalendly && (
          <p className="text-sm text-slate-400 text-center py-8">No support options are enabled for this widget.</p>
        )}
      </div>
    </div>
  );
}

function MenuRow({ color, icon, title, subtitle, onClick, external }: {
  color: string; icon: React.ReactNode; title: string; subtitle: string;
  onClick: () => void; external?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3.5 py-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all flex items-start gap-3"
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `${color}15`, color }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="font-semibold text-sm text-slate-800">{title}</span>
          {external && <ExternalLink size={11} className="text-slate-400" />}
        </span>
        <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</span>
      </span>
      <ChevronRight size={16} className="text-slate-300 mt-2 flex-shrink-0" />
    </button>
  );
}

// ─── Chat View ──────────────────────────────────────────────────────────────

function ChatView({ widgetKey, color, productName }: {
  widgetKey: string; color: string; productName: string;
}) {
  const storageKey = useMemo(() => `cs-widget-history-${widgetKey}`, [widgetKey]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch { /* */ }
  }, [storageKey]);

  useEffect(() => {
    try {
      const persistable = messages.filter((m) => !m.streaming);
      sessionStorage.setItem(storageKey, JSON.stringify(persistable));
    } catch { /* */ }
  }, [messages, storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || loading || !widgetKey) return;

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);

    const userMsg: Message = { role: "user", content: question };
    const placeholder: Message = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, placeholder]);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`/api/widget/chat?key=${encodeURIComponent(widgetKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        throw new Error(err || `HTTP ${res.status}`);
      }

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
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: visible, streaming: true };
                return next;
              });
            } else if (event.type === "done") {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: event.answer,
                  articles: event.articles ?? [],
                  exchangeId: event.exchangeId,
                  streaming: false,
                };
                return next;
              });
            } else if (event.type === "error") {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: `Sorry, something went wrong: ${event.message}`, streaming: false };
                return next;
              });
            }
          } catch { /* */ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `Sorry, I couldn't reach the assistant. ${err instanceof Error ? err.message : ""}`, streaming: false };
        return next;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, widgetKey]);

  const resetChat = () => {
    setMessages([]);
    try { sessionStorage.removeItem(storageKey); } catch { /* */ }
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 py-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
              <HelpCircle size={22} />
            </div>
            <p className="text-sm font-medium text-slate-600">How can I help?</p>
            <p className="text-xs">Ask me anything about {productName}.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              color={color}
              widgetKey={widgetKey}
              userQuestion={msg.role === "assistant" ? (messages[i - 1]?.content ?? "") : ""}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length > 0 && (
        <div className="px-4 pb-1 flex-shrink-0">
          <button onClick={resetChat} className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Start a new chat
          </button>
        </div>
      )}

      <form onSubmit={send} className="px-3 py-3 border-t border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white focus-within:ring-2 focus-within:border-transparent transition">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask a question..."
            rows={1}
            disabled={loading}
            className="flex-1 resize-none px-3 py-2.5 bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none disabled:opacity-50"
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
            className="flex-shrink-0 m-1.5 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white"
            style={{ backgroundColor: color }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </form>
    </>
  );
}

function MessageBubble({ msg, color, widgetKey, userQuestion }: { msg: Message; color: string; widgetKey: string; userQuestion: string }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm whitespace-pre-wrap text-white" style={{ backgroundColor: color }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2 w-full">
        <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-sm text-slate-800 agent-markdown leading-relaxed">
          {msg.content ? (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
          ) : (
            msg.streaming && (
              <span className="inline-flex gap-1 items-center text-slate-400">
                <Loader2 size={12} className="animate-spin" />Thinking...
              </span>
            )
          )}
          {msg.streaming && msg.content && (
            <span className="inline-block w-0.5 h-4 animate-pulse ml-0.5 align-middle" style={{ backgroundColor: color }} />
          )}
        </div>

        {!msg.streaming && msg.articles && msg.articles.length > 0 && (
          <div className="space-y-1">
            {msg.articles.map((a) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-colors text-slate-700"
              >
                <ExternalLink size={11} className="flex-shrink-0 text-slate-400" />
                <span className="truncate">{a.title}</span>
              </a>
            ))}
          </div>
        )}

        {!msg.streaming && msg.exchangeId && (
          <RatingBar
            widgetKey={widgetKey}
            exchangeId={msg.exchangeId}
            question={userQuestion}
            answer={msg.content}
            initial={msg.rating ?? null}
          />
        )}
      </div>
    </div>
  );
}

function RatingBar({ widgetKey, exchangeId, question, answer, initial }: {
  widgetKey: string; exchangeId: string; question: string; answer: string; initial: number | null;
}) {
  const [rating, setRating] = useState<number | null>(initial);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  const post = async (value: number, fb: string | null) => {
    setSaving(true);
    try {
      await fetch(`/api/widget/rate?key=${encodeURIComponent(widgetKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchangeId, rating: value, feedback: fb, question, answer }),
      });
      setRating(value);
      setShowFeedback(false);
    } catch { /* */ }
    setSaving(false);
  };

  const handleClick = (v: number) => {
    if (v === 1) { setRating(v); setShowFeedback(true); }
    else post(v, null);
  };

  const colors = ["", "text-red-400", "text-amber-400", "text-emerald-400"];
  const fillColors = ["", "fill-red-400 text-red-400", "fill-amber-400 text-amber-400", "fill-emerald-400 text-emerald-400"];

  return (
    <div className="pt-0.5">
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
              aria-label={`Rate ${v}`}
            >
              <Star size={12} className={active ? fillColors[hovered ?? rating ?? v] : "text-slate-300"} />
            </button>
          );
        })}
        {rating && (
          <span className={`ml-1 text-[10px] font-medium ${colors[rating]}`}>
            {rating === 1 ? "Not helpful" : rating === 2 ? "OK" : "Great"}
          </span>
        )}
      </div>
      {showFeedback && (
        <div className="mt-1.5 space-y-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What would have been more helpful?"
            rows={2}
            className="w-full rounded-lg border border-red-200 bg-red-50/30 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-red-300"
          />
          <div className="flex gap-1.5">
            <button onClick={() => post(1, feedback || null)} disabled={saving} className="rounded-md bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-50">
              Submit
            </button>
            <button onClick={() => { setShowFeedback(false); post(1, null); }} className="rounded-md px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Email View ─────────────────────────────────────────────────────────────

function EmailView({ widgetKey, color, onSent }: { widgetKey: string; color: string; onSent: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !description.trim() || !email.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setSubmitting(true);
    try {
      const sourceUrl = (() => {
        try { return document.referrer || window.parent.location.href; } catch { return ""; }
      })();
      const res = await fetch(`/api/widget/ticket?key=${encodeURIComponent(widgetKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), description: description.trim(), email: email.trim(), sourceUrl }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSent(true);
      setTimeout(onSent, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
          <Check size={24} />
        </div>
        <h3 className="font-semibold text-slate-800">Thanks — we&apos;ve got your message.</h3>
        <p className="text-sm text-slate-500 max-w-xs">A member of our support team will get back to you at <strong>{email}</strong> within one business day.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      <p className="text-sm text-slate-500">Send us a detailed message. We&apos;ll reply by email within one business day.</p>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Problem overview</span>
        <input
          type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
          placeholder="A short summary of your issue" maxLength={200} disabled={submitting}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50"
          style={{ outlineColor: color }}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Description</span>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What exactly are you trying to do? What's happening instead?"
          rows={6} maxLength={6000} disabled={submitting}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50 resize-none"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-700">Your email</span>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" maxLength={200} disabled={submitting}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50"
        />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit" disabled={submitting}
        className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        style={{ backgroundColor: color }}
      >
        {submitting ? <><Loader2 size={14} className="animate-spin" />Sending…</> : "Submit"}
      </button>
    </form>
  );
}
