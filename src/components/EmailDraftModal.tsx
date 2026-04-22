"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, Sparkles, Mail, Send, Search, CheckCircle, AlertCircle } from "lucide-react";

interface HubSpotThread {
  threadId: string;
  subject: string | null;
  latestMessage: string | null;
  contactName: string | null;
  contactEmail: string | null;
  updatedAt: string | null;
  channelId: string | null;
  channelAccountId: string | null;
}

type Destination = "idle" | "gmail-saving" | "hubspot-selecting" | "hubspot-sending";
type Result = { type: "gmail-success" | "hubspot-success" | "error"; message: string } | null;

interface EmailDraftModalProps {
  messageId: number;
  onClose: () => void;
}

export default function EmailDraftModal({ messageId, onClose }: EmailDraftModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isGenerating, setIsGenerating] = useState(true);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Refinement
  const [refinementInstruction, setRefinementInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Destination
  const [destination, setDestination] = useState<Destination>("idle");
  const [result, setResult] = useState<Result>(null);

  // HubSpot thread search
  const [hubspotQuery, setHubspotQuery] = useState("");
  const [hubspotThreads, setHubspotThreads] = useState<HubSpotThread[]>([]);
  const [hubspotSearching, setHubspotSearching] = useState(false);
  const [selectedThread, setSelectedThread] = useState<HubSpotThread | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadPickerRef = useRef<HTMLDivElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);

  // Generate initial draft on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/agent/email-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        });
        if (!res.ok) {
          const data = await res.json();
          setGenerateError(data.error || "Failed to generate draft");
          return;
        }
        const data = await res.json();
        setSubject(data.subject);
        setBody(data.body);
      } catch {
        setGenerateError("Network error");
      } finally {
        setIsGenerating(false);
      }
    })();
  }, [messageId]);

  // Set body HTML in contentEditable after generation/refinement
  useEffect(() => {
    if (bodyRef.current && body && !isGenerating) {
      bodyRef.current.innerHTML = body;
    }
  }, [body, isGenerating]);

  const readBodyFromEditor = useCallback(() => {
    return bodyRef.current?.innerHTML ?? body;
  }, [body]);

  // Refinement
  const handleRefine = async () => {
    if (!refinementInstruction.trim() || isRefining) return;
    setIsRefining(true);
    try {
      const currentBody = readBodyFromEditor();
      const res = await fetch("/api/agent/email-draft/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, subject, body: currentBody, instruction: refinementInstruction }),
      });
      if (res.ok) {
        const data = await res.json();
        setSubject(data.subject);
        setBody(data.body);
        setRefinementInstruction("");
      }
    } catch { /* preserve current draft */ }
    setIsRefining(false);
  };

  // Gmail draft
  const handleGmailDraft = async () => {
    setDestination("gmail-saving");
    setResult(null);
    try {
      const currentBody = readBodyFromEditor();
      const res = await fetch("/api/agent/email-draft/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: currentBody }),
      });
      if (!res.ok) {
        const data = await res.json();
        setResult({ type: "error", message: data.error === "gmail_not_connected" ? "Connect Gmail in My Profile first" : data.error || "Failed" });
        setDestination("idle");
        return;
      }
      setResult({ type: "gmail-success", message: "Draft saved to Gmail" });
      setTimeout(onClose, 2000);
    } catch {
      setResult({ type: "error", message: "Network error" });
      setDestination("idle");
    }
  };

  // HubSpot thread search (debounced)
  const searchThreads = useCallback(async (q: string) => {
    setHubspotSearching(true);
    try {
      const res = await fetch(`/api/agent/email-draft/hubspot-threads?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setHubspotThreads(data.threads ?? []);
        setTimeout(() => threadPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
      }
    } catch { /* ignore */ }
    setHubspotSearching(false);
  }, []);

  useEffect(() => {
    if (destination !== "hubspot-selecting") return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => searchThreads(hubspotQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [hubspotQuery, destination, searchThreads]);

  // Load threads immediately when HubSpot panel opens + scroll to show loading state
  useEffect(() => {
    if (destination === "hubspot-selecting") {
      searchThreads("");
      setTimeout(() => threadPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    }
  }, [destination, searchThreads]);

  // Scroll to send button when a contact is selected
  useEffect(() => {
    if (selectedThread) {
      setTimeout(() => sendButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    }
  }, [selectedThread]);

  // HubSpot reply
  const handleHubspotReply = async () => {
    if (!selectedThread) return;
    setDestination("hubspot-sending");
    setResult(null);
    try {
      const currentBody = readBodyFromEditor();
      const res = await fetch("/api/agent/email-draft/hubspot-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThread.threadId,
          subject,
          body: currentBody,
          channelId: selectedThread.channelId,
          channelAccountId: selectedThread.channelAccountId,
          contactEmail: selectedThread.contactEmail,
          contactName: selectedThread.contactName,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setResult({ type: "error", message: data.error || "Failed to send reply" });
        setDestination("hubspot-selecting");
        return;
      }
      setResult({ type: "hubspot-success", message: `Reply sent to ${selectedThread.contactName || selectedThread.contactEmail || "thread"}` });
      setTimeout(onClose, 2000);
    } catch {
      setResult({ type: "error", message: "Network error" });
      setDestination("hubspot-selecting");
    }
  };

  const isBusy = isGenerating || isRefining || destination === "gmail-saving" || destination === "hubspot-sending";

  return (
    <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Mail size={16} className="text-mint-600" />
            <h2 className="text-base font-bold text-slate-900">Compose Email</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
              <Loader2 size={24} className="animate-spin text-mint-500" />
              <span className="text-sm">Generating draft...</span>
            </div>
          ) : generateError ? (
            <div className="flex flex-col items-center justify-center py-16 text-red-500 gap-2">
              <AlertCircle size={20} />
              <span className="text-sm">{generateError}</span>
            </div>
          ) : (
            <>
              {/* Subject */}
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-mint-400"
                  disabled={isBusy}
                />
              </div>

              {/* Body (contentEditable) */}
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Body</label>
                <div
                  ref={bodyRef}
                  contentEditable={!isBusy}
                  suppressContentEditableWarning
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-mint-400 min-h-[200px] max-h-[300px] overflow-y-auto leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_a]:text-mint-600 [&_a]:underline"
                />
              </div>

              {/* Refinement bar */}
              <div className="flex items-center gap-2">
                <input
                  value={refinementInstruction}
                  onChange={(e) => setRefinementInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                  placeholder="Ask AI to refine... (e.g., &quot;make it shorter&quot;, &quot;add a greeting&quot;)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  disabled={isBusy}
                />
                <button
                  onClick={handleRefine}
                  disabled={!refinementInstruction.trim() || isBusy}
                  className="flex items-center gap-1 rounded-lg bg-violet-50 border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40 transition-colors"
                >
                  {isRefining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Refine
                </button>
              </div>

              {/* Result banner */}
              {result && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                  result.type === "error"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}>
                  {result.type === "error" ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
                  {result.message}
                </div>
              )}

              {/* HubSpot thread picker */}
              {(destination === "hubspot-selecting" || destination === "hubspot-sending") && (
                <div ref={threadPickerRef} className="border border-orange-200 rounded-lg bg-orange-50/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Search size={13} className="text-orange-500" />
                    <span className="text-xs font-semibold text-orange-700">Select a conversation thread</span>
                  </div>
                  <input
                    value={hubspotQuery}
                    onChange={(e) => setHubspotQuery(e.target.value)}
                    placeholder="Search by contact name, email, or subject..."
                    className="w-full rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-300"
                    disabled={destination === "hubspot-sending"}
                  />
                  <div className="max-h-[160px] overflow-y-auto space-y-1">
                    {hubspotSearching ? (
                      <div className="flex items-center justify-center py-4 text-slate-400 gap-2">
                        <Loader2 size={12} className="animate-spin" /><span className="text-xs">Searching...</span>
                      </div>
                    ) : hubspotThreads.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">No threads found</p>
                    ) : (
                      hubspotThreads.map((t) => (
                        <button
                          key={t.threadId}
                          onClick={() => setSelectedThread(t)}
                          disabled={destination === "hubspot-sending"}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                            selectedThread?.threadId === t.threadId
                              ? "border-orange-400 bg-orange-100/50 ring-1 ring-orange-300"
                              : "border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/30"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-800 truncate">
                              {t.contactName || t.contactEmail || "Unknown contact"}
                            </span>
                            {t.updatedAt && (
                              <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">
                                {new Date(t.updatedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {t.subject && <p className="text-slate-500 truncate mt-0.5">{t.subject}</p>}
                          {t.latestMessage && <p className="text-slate-400 truncate mt-0.5">{t.latestMessage}</p>}
                        </button>
                      ))
                    )}
                  </div>
                  {selectedThread && (
                    <button
                      ref={sendButtonRef}
                      onClick={handleHubspotReply}
                      disabled={destination === "hubspot-sending"}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                    >
                      {destination === "hubspot-sending" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Send Reply to {selectedThread.contactName || selectedThread.contactEmail || "thread"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {!isGenerating && !generateError && (
          <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-3">
            <button
              onClick={handleGmailDraft}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              {destination === "gmail-saving" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
              Save as Gmail Draft
            </button>
            <button
              onClick={() => setDestination((d) => d === "hubspot-selecting" ? "idle" : "hubspot-selecting")}
              disabled={destination === "gmail-saving" || destination === "hubspot-sending"}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors disabled:opacity-40 ${
                (destination === "hubspot-selecting" || destination === "hubspot-sending") && !selectedThread
                  ? "bg-orange-500 text-white hover:bg-orange-600"
                  : destination === "hubspot-selecting" || destination === "hubspot-sending"
                    ? "border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100"
                    : "bg-mint-600 text-white hover:bg-mint-700"
              }`}
            >
              <Send size={13} />
              Reply via HubSpot
            </button>
            {destination === "hubspot-selecting" && (
              <span className="text-[10px] text-slate-400">Sends immediately to the conversation thread</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
