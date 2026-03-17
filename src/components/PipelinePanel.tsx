"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, RefreshCw, GitBranch, Loader2, CheckCircle2, AlertCircle, Radio, FlaskConical, Globe } from "lucide-react";

type RunMode = "incremental" | "full" | "recluster" | "test" | "scrape-kb";
type Status = "idle" | "running" | "done" | "error";

interface PipelineStats {
  tickets_fetched?: number;
  tickets_new?: number;
  qa_extracted?: number;
  categories_total?: number;
  reclustered?: boolean;
  errors?: number;
}

interface JobSnapshot {
  status: Status;
  mode: string | null;
  logs: string[];
  progress: { current: number; total: number } | null;
  stats: PipelineStats | null;
}

interface SyncPreview {
  total: number;
  new: number;
  updated: number;
  unprocessed_in_db: number;
  mode: string;
  since: string | null;
}

export function PipelinePanel({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [finalStats, setFinalStats] = useState<PipelineStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [testLimit, setTestLimit] = useState(3);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const connectToStatus = useCallback(() => {
    readerRef.current?.cancel().catch(() => {});

    fetch("/api/pipeline/status")
      .then((res) => {
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        readerRef.current = reader;
        setConnected(true);

        const decoder = new TextDecoder();
        let buffer = "";

        const read = () => {
          reader.read().then(({ done, value }) => {
            if (done) { setConnected(false); return; }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "snapshot") {
                  const snap = event as JobSnapshot;
                  setStatus(snap.status);
                  setLogs(snap.logs ?? []);
                  setProgress(snap.progress ?? null);
                  setFinalStats(snap.stats ?? null);
                } else if (event.type === "log") {
                  setLogs((p) => [...p, event.message as string]);
                } else if (event.type === "progress") {
                  setProgress({ current: event.current as number, total: event.total as number });
                  setLogs((p) => [...p, event.message as string]);
                } else if (event.type === "done") {
                  setFinalStats(event.stats as PipelineStats);
                  setStatus("done");
                  setProgress(null);
                  onDoneRef.current?.();
                } else if (event.type === "error") {
                  setLogs((p) => [...p, `✗ ERROR: ${event.message}`]);
                  setStatus("error");
                }
              } catch { /* ignore */ }
            }

            read();
          }).catch(() => setConnected(false));
        };

        read();
      })
      .catch(() => setConnected(false));
  }, []);

  // On mount, check if a pipeline is already running
  useEffect(() => {
    connectToStatus();
    return () => { readerRef.current?.cancel().catch(() => {}); };
  }, [connectToStatus]);

  const fetchPreview = async (mode: "incremental" | "full") => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/pipeline/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json() as SyncPreview;
        setPreview(data);
      }
    } catch { /* ignore */ }
    setPreviewLoading(false);
  };

  const confirmAndRun = async () => {
    if (!preview) return;
    const mode = preview.mode as RunMode;
    setPreview(null);
    await startRun(mode);
  };

  const startRun = async (mode: RunMode) => {
    setLogs([]);
    setProgress(null);
    setFinalStats(null);

    const res = await fetch("/api/pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...(mode === "test" ? { testLimit } : {}) }),
    });

    if (res.status === 409) {
      return;
    }
    if (!res.ok) {
      setLogs(["✗ Failed to start pipeline."]);
      setStatus("error");
      return;
    }

    setStatus("running");
    connectToStatus();
  };

  const run = async (mode: RunMode) => {
    if (mode === "incremental" || mode === "full") {
      await fetchPreview(mode as "incremental" | "full");
    } else {
      await startRun(mode);
    }
  };

  const buttons: { mode: RunMode; label: string; desc: string; icon: typeof Play; color: string }[] = [
    { mode: "incremental", label: "Sync Incremental", desc: "New tickets only", icon: Play, color: "bg-indigo-600 hover:bg-indigo-700 text-white" },
    { mode: "full", label: "Sync Full", desc: "All tickets", icon: RefreshCw, color: "bg-slate-700 hover:bg-slate-800 text-white" },
    { mode: "recluster", label: "Re-clustering", desc: "New taxonomy", icon: GitBranch, color: "bg-violet-600 hover:bg-violet-700 text-white" },
    { mode: "scrape-kb", label: "Scrape KB", desc: "Public articles", icon: Globe, color: "bg-cyan-600 hover:bg-cyan-700 text-white" },
  ];

  return (
    <div className="space-y-5">
      {/* Running indicator */}
      {status === "running" && (
        <div className="flex items-center gap-2 text-sm text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
          <Radio size={14} className="animate-pulse" />
          <span className="font-medium">Pipeline running in background</span>
          <span className="text-xs text-indigo-400 ml-auto">
            {connected ? "● Live" : "○ Reconnecting..."}
          </span>
        </div>
      )}

      {/* Test section */}
      <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <FlaskConical size={18} className="text-amber-600 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800">Test Mode</p>
          <p className="text-xs text-amber-600">Fetch tickets and show input/output without saving anything</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={20}
            value={testLimit}
            onChange={(e) => setTestLimit(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            disabled={status === "running"}
            className="w-16 px-2 py-1.5 text-sm border border-amber-300 rounded-lg bg-white text-amber-900 text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <span className="text-xs text-amber-600">tickets</span>
          <button
            onClick={() => run("test")}
            disabled={status === "running"}
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "running" ? <Loader2 size={14} className="animate-spin" /> : "Run Test"}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {buttons.map(({ mode, label, desc, icon: Icon, color }) => (
          <button
            key={mode}
            onClick={() => run(mode)}
            disabled={status === "running"}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm ${color}`}
          >
            {status === "running" ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
            <div className="text-left">
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-xs opacity-75">{desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Sync preview / confirmation */}
      {previewLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <Loader2 size={14} className="animate-spin" />
          <span>Checking HubSpot for tickets...</span>
        </div>
      )}
      {preview && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
          <div className="text-sm text-indigo-900">
            <p className="font-semibold mb-1">
              {preview.total} ticket{preview.total !== 1 ? "s" : ""} found
              {preview.since ? ` (modified since ${preview.since})` : " (all)"}
            </p>
            <div className="flex gap-4 text-xs text-indigo-700">
              <span>{preview.new} new</span>
              <span>{preview.updated} already in DB</span>
              {preview.unprocessed_in_db > 0 && (
                <span>{preview.unprocessed_in_db} pending processing</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmAndRun}
              className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-all"
            >
              Confirm & Sync
            </button>
            <button
              onClick={() => setPreview(null)}
              className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress && status === "running" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Processing tickets...</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Terminal logs */}
      {logs.length > 0 && (
        <div
          ref={logRef}
          className="log-output bg-slate-900 rounded-xl p-4 h-96 overflow-y-auto font-mono text-xs text-slate-300 space-y-1"
        >
          {logs.map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith("✓") || line.startsWith("  ✓") ? "text-emerald-400"
                : line.startsWith("✗") || line.includes("ERROR") ? "text-red-400"
                : line.startsWith("Re-") || line.startsWith("Starting") || line.startsWith("Auto") ? "text-violet-400"
                : "text-slate-300"
              }
            >
              {line}
            </div>
          ))}
          {status === "running" && (
            <div className="flex items-center gap-1.5 text-indigo-400">
              <Loader2 size={12} className="animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </div>
      )}

      {/* Final stats */}
      {finalStats && status === "done" && (
        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-emerald-800 space-y-0.5">
            <p className="font-semibold">Pipeline completed</p>
            <p className="text-xs text-emerald-700">
              {finalStats.tickets_fetched} tickets · {finalStats.qa_extracted} Q&A extracted ·{" "}
              {finalStats.categories_total} categories
              {finalStats.reclustered && " · Re-clustering executed"}
              {finalStats.errors ? ` · ${finalStats.errors} errors` : ""}
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">
            The pipeline finished with errors. Check the log and verify your environment variables.
          </p>
        </div>
      )}
    </div>
  );
}
