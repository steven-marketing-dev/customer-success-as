"use client";

import { useState, useEffect, useCallback } from "react";
import { LayoutDashboard, BookOpen, Zap, RefreshCw, Trash2, MessageCircle, BookA } from "lucide-react";
import { StatsGrid } from "@/components/StatsGrid";
import { CategoryGrid, type CategorySummary } from "@/components/CategoryGrid";
import { SearchPanel } from "@/components/SearchPanel";
import { PipelinePanel } from "@/components/PipelinePanel";
import { AgentPanel } from "@/components/AgentPanel";
import { TermsPanel } from "@/components/TermsPanel";
import { ArticlesPanel } from "@/components/ArticlesPanel";
import { BehavioralCardsPanel } from "@/components/BehavioralCardsPanel";
import { RefDocsPanel } from "@/components/RefDocsPanel";
import { QACard, type QAItem } from "@/components/QACard";

type Tab = "dashboard" | "kb" | "pipeline" | "agent" | "glossary";
type KBSubTab = "qa" | "articles" | "refs";
type AgentSubTab = "chat" | "rules";

interface KBData {
  stats: {
    tickets: number;
    qa_pairs: number;
    categories: number;
    last_sync_at: number | null;
  };
  categories: CategorySummary[];
  recent_qa: QAItem[];
}

const tabs: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "kb", label: "Knowledge Base", icon: BookOpen },
  { id: "glossary", label: "Glossary", icon: BookA },
  { id: "agent", label: "Agent", icon: MessageCircle },
  { id: "pipeline", label: "Pipeline", icon: Zap },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<KBData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [kbSubTab, setKbSubTab] = useState<KBSubTab>("qa");
  const [agentSubTab, setAgentSubTab] = useState<AgentSubTab>("chat");
  const [clearing, setClearing] = useState(false);

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/kb");
      const json = await res.json() as KBData;
      setData(json);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const clearDatabase = useCallback(async () => {
    if (!confirm("Clear all data from the database? This cannot be undone.")) return;
    setClearing(true);
    try {
      await fetch("/api/db/clear", { method: "POST" });
      await fetchData(true);
    } finally {
      setClearing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                <BookOpen size={14} className="text-white" />
              </div>
              <span className="font-semibold text-slate-900 text-sm">
                CS Knowledge Base
              </span>
            </div>

            {/* Tabs */}
            <nav className="flex items-center">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg mx-0.5 transition-all ${
                    tab === id
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <Icon size={15} />
                  <span className="hidden sm:block">{label}</span>
                </button>
              ))}
            </nav>

            {/* Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-40"
              title="Refresh data"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-400">Loading knowledge base...</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Dashboard ─────────────────────────────────────────────────────── */}
            {tab === "dashboard" && data && (
              <div className="space-y-8">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 mb-1">Dashboard</h1>
                  <p className="text-sm text-slate-500">
                    Knowledge Base auto-populated from HubSpot
                  </p>
                </div>

                <StatsGrid stats={data.stats} />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Category distribution */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                        Categories
                      </h2>
                      <button
                        onClick={() => setTab("kb")}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        View all →
                      </button>
                    </div>
                    <CategoryGrid
                      categories={data.categories.slice(0, 8)}
                      onSelect={() => setTab("kb")}
                    />
                  </div>

                  {/* Recent Q&A */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                        Recent Q&A
                      </h2>
                      <button
                        onClick={() => setTab("kb")}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Search →
                      </button>
                    </div>
                    {data.recent_qa.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
                        <p className="text-sm">No data yet.</p>
                        <button
                          onClick={() => setTab("pipeline")}
                          className="mt-2 text-xs text-indigo-600 hover:underline"
                        >
                          Run the pipeline →
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.recent_qa.slice(0, 4).map((qa) => (
                          <QACard key={qa.id} qa={qa} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Knowledge Base ────────────────────────────────────────────────── */}
            {tab === "kb" && data && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 mb-1">Knowledge Base</h1>
                    <p className="text-sm text-slate-500">
                      {data.stats.qa_pairs} answers across {data.stats.categories} categories
                    </p>
                  </div>
                  {/* Sub-tab toggle */}
                  <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {(["qa", "articles", "refs"] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setKbSubTab(st)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          kbSubTab === st
                            ? "bg-indigo-50 text-indigo-700"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {st === "qa" ? "Q&A" : st === "articles" ? "Articles" : "References"}
                      </button>
                    ))}
                  </div>
                </div>

                {kbSubTab === "qa" ? (
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Sidebar categories */}
                    <div className="lg:col-span-1">
                      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                        Categories
                      </h2>
                      <CategoryGrid
                        categories={data.categories}
                        selectedId={selectedCategory}
                        onSelect={setSelectedCategory}
                      />
                    </div>

                    {/* Search + results */}
                    <div className="lg:col-span-3">
                      <SearchPanel
                        initialResults={data.recent_qa}
                        categories={data.categories}
                        selectedCategory={selectedCategory}
                        onCategoryChange={setSelectedCategory}
                      />
                    </div>
                  </div>
                ) : kbSubTab === "articles" ? (
                  <ArticlesPanel />
                ) : (
                  <RefDocsPanel />
                )}
              </div>
            )}

            {/* ── Glossary ───────────────────────────────────────────────────────── */}
            {tab === "glossary" && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 mb-1">Glossary</h1>
                  <p className="text-sm text-slate-500">
                    Product terms and definitions — auto-linked to related Q&A cards
                  </p>
                </div>
                <TermsPanel />
              </div>
            )}

            {/* ── Agent ────────────────────────────────────────────────────────── */}
            {tab === "agent" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 mb-1">AI Agent</h1>
                    <p className="text-sm text-slate-500">
                      {agentSubTab === "chat"
                        ? "Ask questions — answers are grounded in your knowledge base only"
                        : "Behavioral rules that shape how the agent responds"}
                    </p>
                  </div>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                    {(["chat", "rules"] as AgentSubTab[]).map((st) => (
                      <button
                        key={st}
                        onClick={() => setAgentSubTab(st)}
                        className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                          agentSubTab === st
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {st === "chat" ? "Chat" : "Rules"}
                      </button>
                    ))}
                  </div>
                </div>
                {agentSubTab === "chat" ? <AgentPanel /> : <BehavioralCardsPanel />}
              </div>
            )}

            {/* ── Pipeline ──────────────────────────────────────────────────────── */}
            {tab === "pipeline" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 mb-1">Pipeline</h1>
                  <p className="text-sm text-slate-500">
                    Sync tickets from HubSpot and update the knowledge base
                  </p>
                </div>

                {/* Env check */}
                {(!process.env.NEXT_PUBLIC_HAS_HUBSPOT) && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm text-amber-800 font-medium">
                      Make sure to configure your{" "}
                      <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code>{" "}
                      file
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Required: HUBSPOT_ACCESS_TOKEN and ANTHROPIC_API_KEY
                    </p>
                  </div>
                )}

                <PipelinePanel onDone={() => fetchData(true)} />

                {/* Danger zone */}
                <div className="bg-white rounded-xl border border-red-100 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Danger Zone</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600">Clear Database</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Delete all tickets, Q&A pairs, and categories. Cannot be undone.
                      </p>
                    </div>
                    <button
                      onClick={clearDatabase}
                      disabled={clearing}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={14} className={clearing ? "animate-spin" : ""} />
                      {clearing ? "Clearing..." : "Clear"}
                    </button>
                  </div>
                </div>

                {/* How it works */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">How it works</h3>
                  <div className="space-y-2 text-xs text-slate-500">
                    {[
                      ["Incremental Sync", "Fetches only new/modified tickets since the last sync. Fast and efficient."],
                      ["Full Sync", "Processes all tickets from HubSpot. Use it the first time or to reprocess everything."],
                      ["Re-clustering", "Claude analyzes the entire KB with advanced reasoning and creates a more coherent new category taxonomy."],
                      ["Scrape KB", "Fetches articles from the public knowledge base website and stores them for agent context."],
                    ].map(([title, desc]) => (
                      <div key={title} className="flex gap-2">
                        <span className="font-medium text-slate-700 min-w-[130px]">{title}:</span>
                        <span>{desc}</span>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1 border-t border-slate-100">
                      <span className="font-medium text-slate-700 min-w-[130px]">Auto-recluster:</span>
                      <span>
                        Triggers automatically every{" "}
                        <code className="font-mono bg-slate-100 px-1 rounded">
                          RECLUSTER_THRESHOLD
                        </code>{" "}
                        new tickets (default: 20).
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
