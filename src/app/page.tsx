"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { LayoutDashboard, BookOpen, Zap, RefreshCw, Trash2, MessageCircle, BookA, LogOut, UserPlus, Users, X, ChevronDown, Star, ClipboardList, AlertCircle, Sparkles, Settings, Mail, Link2, Paperclip } from "lucide-react";
import { StatsGrid } from "@/components/StatsGrid";
import { CategoryGrid, type CategorySummary } from "@/components/CategoryGrid";
import { SearchPanel } from "@/components/SearchPanel";
import { PipelinePanel } from "@/components/PipelinePanel";
import { AgentPanel, type AuthUser, type AgentPanelHandle } from "@/components/AgentPanel";
import { TermsPanel } from "@/components/TermsPanel";
import { ArticlesPanel } from "@/components/ArticlesPanel";
import { BehavioralCardsPanel } from "@/components/BehavioralCardsPanel";
import { RefDocsPanel } from "@/components/RefDocsPanel";
import VideoGuidesPanel from "@/components/VideoGuidesPanel";
import { QACard, type QAItem } from "@/components/QACard";

type Tab = "dashboard" | "kb" | "pipeline" | "agent" | "glossary";
type KBSubTab = "qa" | "articles" | "refs" | "videos";
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
  const [tab, setTab] = useState<Tab>("agent");
  const [data, setData] = useState<KBData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [kbSubTab, setKbSubTab] = useState<KBSubTab>("qa");
  const [agentSubTab, setAgentSubTab] = useState<AgentSubTab>("chat");
  const [clearing, setClearing] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [managedUsers, setManagedUsers] = useState<Array<{ id: number; username: string; display_name: string | null; role: string; created_at: number }>>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [showAdminDropdown, setShowAdminDropdown] = useState(false);
  const [showRatingsHistory, setShowRatingsHistory] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [profileCalendlyUrl, setProfileCalendlyUrl] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [ratedMessages, setRatedMessages] = useState<Array<{
    id: number; content: string; rating: number; feedback: string | null;
    username: string; rated_at: number; conversation_id: number;
    role: string; question?: string | null;
    actions?: {
      corrections: Array<{ id: number; qa_id: number; field_name: string; old_value: string | null; new_value: string | null; created_at: number }>;
      behavioralCards: Array<{ id: number; title: string; instruction: string; type: string; scope: string; source: string; created_at: number }>;
    };
  }>>([]);

  // Agent panel ref (for tour)
  const agentPanelRef = useRef<AgentPanelHandle>(null);

  // Tour / "What's new" state
  const [completedTours, setCompletedTours] = useState<string[]>([]);

  // Load completed tours on mount
  useEffect(() => {
    fetch("/api/tours").then((r) => r.json()).then((d) => setCompletedTours(d.completed ?? [])).catch(() => {});
  }, []);

  // Auto-show "What's new" modal for users who haven't seen it
  useEffect(() => {
    if (!user || completedTours.includes("whats-new-v2")) return;
    const t = setTimeout(() => setShowWhatsNew(true), 1500);
    return () => clearTimeout(t);
  }, [user, completedTours]);

  // Fetch current user
  useEffect(() => {
    fetch("/api/auth/me").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    }).catch(() => {});

    // Check for Gmail OAuth callback results
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmailConnected") === "true" || params.get("gmailError")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendly_url: profileCalendlyUrl.trim() || null,
          display_name: profileDisplayName.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setProfileError(data.error || "Failed to save");
        return;
      }
      const data = await res.json();
      setUser((prev) => prev ? { ...prev, ...data.user } : prev);
      setShowProfileSettings(false);
    } catch {
      setProfileError("Network error");
    } finally {
      setProfileSaving(false);
    }
  };

  const connectGmail = async () => {
    setGmailConnecting(true);
    try {
      const res = await fetch("/api/auth/gmail");
      if (!res.ok) {
        const data = await res.json();
        setProfileError(data.error || "Failed to start Gmail connection");
        return;
      }
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch {
      setProfileError("Failed to connect Gmail");
      setGmailConnecting(false);
    }
  };

  const disconnectGmail = async () => {
    try {
      await fetch("/api/auth/gmail/status", { method: "DELETE" });
      setUser((prev) => prev ? { ...prev, gmail_connected: false, gmail_email: null } : prev);
    } catch { /* ignore */ }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const loadUsers = async () => {
    const res = await fetch("/api/auth/users");
    if (res.ok) setManagedUsers(await res.json());
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) return;
    await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newPassword, display_name: newDisplayName || null }),
    });
    setNewUsername(""); setNewPassword(""); setNewDisplayName("");
    loadUsers();
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    await fetch(`/api/auth/users/${id}`, { method: "DELETE" });
    loadUsers();
  };

  const loadRatingsHistory = async () => {
    const res = await fetch("/api/stats/ratings?history=1");
    if (res.ok) {
      const data = await res.json();
      setRatedMessages(data.history ?? []);
    }
  };

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
    <div className="min-h-screen" style={{ background: "var(--bg, #FAF9F6)" }}>

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-warm-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 mint-gradient rounded-2xl flex items-center justify-center" style={{ boxShadow: "0 2px 8px rgba(51, 178, 156, 0.2)" }}>
                <BookOpen size={16} className="text-white" />
              </div>
              <span className="font-display font-bold text-warm-800 text-sm tracking-tight">
                CS Knowledge Base
              </span>
            </div>

            {/* Tabs */}
            <nav className="flex items-center">
              {tabs
                .filter(({ id }) => id !== "pipeline" || user?.role === "master")
                .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  data-tour={`tab-${id}`}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full mx-0.5 transition-all ${
                    tab === id
                      ? "bg-mint-50 text-mint-700"
                      : "text-warm-500 hover:text-warm-700 hover:bg-warm-100"
                  }`}
                >
                  <Icon size={15} />
                  <span className="hidden sm:block">{label}</span>
                </button>
              ))}
            </nav>

            {/* User menu */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-all disabled:opacity-40"
                title="Refresh data"
              >
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              </button>

              {user && (
                <div className="relative">
                  <button
                    onClick={() => setShowAdminDropdown((p) => !p)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-xs text-slate-600 font-medium hidden sm:block">
                      {user.display_name || user.username}
                    </span>
                    {user.role === "master" && (
                      <span className="px-1.5 py-0.5 rounded-full bg-mint-100 text-mint-600 text-[10px] font-medium">admin</span>
                    )}
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>

                  {showAdminDropdown && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setShowAdminDropdown(false)} />
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-30">
                        <button
                          onClick={() => {
                            setShowAdminDropdown(false);
                            setProfileCalendlyUrl(user.calendly_url || "");
                            setProfileDisplayName(user.display_name || "");
                            setProfileError(null);
                            setShowProfileSettings(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Settings size={13} className="text-slate-400" />My Profile
                        </button>
                        <div className="border-t border-slate-100 my-1" />
                        {user.role === "master" && (
                          <>
                            <button
                              onClick={() => { setShowAdminDropdown(false); setShowUserMgmt(true); loadUsers(); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Users size={13} className="text-slate-400" />Manage Users
                            </button>
                            <button
                              onClick={() => { setShowAdminDropdown(false); setShowRatingsHistory(true); loadRatingsHistory(); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Star size={13} className="text-slate-400" />Ratings History
                            </button>
                            <div className="border-t border-slate-100 my-1" />
                          </>
                        )}
                        <button
                          onClick={() => {
                            setShowAdminDropdown(false);
                            setShowWhatsNew(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-mint-50 hover:text-mint-700 transition-colors"
                        >
                          <Sparkles size={13} className="text-[var(--mint)]" />What&apos;s new?
                        </button>
                        <div className="border-t border-slate-100 my-1" />
                        <button
                          onClick={() => { setShowAdminDropdown(false); handleLogout(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut size={13} />Logout
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-mint-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-warm-400 font-display">Loading knowledge base...</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Dashboard ─────────────────────────────────────────────────────── */}
            {tab === "dashboard" && data && (
              <div className="space-y-8">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Dashboard</h1>
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
                        className="text-xs text-mint-600 hover:text-mint-800 font-medium"
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
                        className="text-xs text-mint-600 hover:text-mint-800 font-medium"
                      >
                        Search →
                      </button>
                    </div>
                    {data.recent_qa.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
                        <p className="text-sm">No data yet.</p>
                        <button
                          onClick={() => setTab("pipeline")}
                          className="mt-2 text-xs text-mint-600 hover:underline"
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
                    <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Knowledge Base</h1>
                    <p className="text-sm text-slate-500">
                      {data.stats.qa_pairs} answers across {data.stats.categories} categories
                    </p>
                  </div>
                  {/* Sub-tab toggle */}
                  <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {(["qa", "articles", "refs", "videos"] as const).map((st) => (
                      <button
                        key={st}
                        data-tour={`subtab-${st}`}
                        onClick={() => setKbSubTab(st)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          kbSubTab === st
                            ? "bg-mint-50 text-mint-700"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {st === "qa" ? "Q&A" : st === "articles" ? "Articles" : st === "refs" ? "References" : "Video Guides"}
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
                ) : kbSubTab === "refs" ? (
                  <RefDocsPanel />
                ) : (
                  <VideoGuidesPanel />
                )}
              </div>
            )}

            {/* ── Glossary ───────────────────────────────────────────────────────── */}
            {tab === "glossary" && (
              <div className="space-y-6">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Glossary</h1>
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
                    <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">AI Agent</h1>
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
                            ? "bg-mint-600 text-white"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {st === "chat" ? "Chat" : "Rules"}
                      </button>
                    ))}
                  </div>
                </div>
                {agentSubTab === "chat" ? <AgentPanel ref={agentPanelRef} user={user} /> : <BehavioralCardsPanel />}
              </div>
            )}

            {/* ── Pipeline ──────────────────────────────────────────────────────── */}
            {tab === "pipeline" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Pipeline</h1>
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

      {/* User Management Modal */}
      {showUserMgmt && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50" onClick={() => setShowUserMgmt(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Manage Users</h2>
              <button onClick={() => setShowUserMgmt(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="space-y-2 border border-slate-200 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><UserPlus size={12} />Add User</h3>
              <div className="grid grid-cols-2 gap-2">
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Username" className="col-span-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-mint-500" />
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password" type="password" className="col-span-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-mint-500" />
                <input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="Display name (optional)" className="col-span-2 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-mint-500" />
              </div>
              <button onClick={createUser} disabled={!newUsername || !newPassword} className="w-full rounded-lg bg-mint-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-700 disabled:opacity-50">Add User</button>
            </div>

            <div className="space-y-1">
              {managedUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{u.display_name || u.username}</span>
                    {u.display_name && <span className="text-xs text-slate-400 ml-1.5">@{u.username}</span>}
                    {u.role === "master" && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-mint-100 text-mint-600 text-[10px] font-medium">admin</span>}
                  </div>
                  {u.id !== user?.id && (
                    <button onClick={() => deleteUser(u.id)} className="text-xs text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ratings History Modal */}
      {showRatingsHistory && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50" onClick={() => setShowRatingsHistory(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <ClipboardList size={18} className="text-mint-600" />
                <h2 className="text-lg font-bold text-slate-900">Ratings History</h2>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">{ratedMessages.length} rated</span>
              </div>
              <button onClick={() => setShowRatingsHistory(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {ratedMessages.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No rated messages yet</p>
              ) : (
                ratedMessages.map((m) => {
                  const ratingColors = { 1: "bg-red-100 text-red-700 border-red-200", 2: "bg-amber-100 text-amber-700 border-amber-200", 3: "bg-emerald-100 text-emerald-700 border-emerald-200" };
                  const ratingLabels = { 1: "Bad", 2: "OK", 3: "Great" };
                  const rc = ratingColors[m.rating as 1 | 2 | 3] ?? ratingColors[2];
                  const rl = ratingLabels[m.rating as 1 | 2 | 3] ?? "?";

                  return (
                    <div key={m.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${rc}`}>
                            {"★".repeat(m.rating)} {rl}
                          </span>
                          <span className="text-xs text-slate-500">by {m.username}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">{new Date(m.rated_at * 1000).toLocaleString()}</span>
                      </div>

                      {/* Question */}
                      {m.question && (
                        <div className="px-4 py-2.5 border-b border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Question</div>
                          <p className="text-sm text-slate-800">{m.question}</p>
                        </div>
                      )}

                      {/* Answer */}
                      <div className="px-4 py-2.5 border-b border-slate-100">
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Agent Answer</div>
                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">{m.content.slice(0, 600)}{m.content.length > 600 ? "..." : ""}</p>
                      </div>

                      {/* Feedback */}
                      {m.feedback && (
                        <div className="px-4 py-2.5 bg-red-50/50 border-b border-slate-100">
                          <div className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">User Feedback</div>
                          <p className="text-xs text-red-700">{m.feedback}</p>
                        </div>
                      )}

                      {/* Actions taken */}
                      {m.actions && (m.actions.corrections.length > 0 || m.actions.behavioralCards.length > 0) && (
                        <div className="px-4 py-2.5 bg-mint-50/30">
                          <div className="text-[10px] font-semibold text-mint-400 uppercase tracking-wide mb-2">Actions Taken</div>

                          {m.actions.corrections.length > 0 && (
                            <div className="mb-2">
                              <div className="text-[10px] text-slate-500 font-medium mb-1">QA Card Corrections ({m.actions.corrections.length}):</div>
                              <div className="space-y-1">
                                {m.actions.corrections.slice(0, 5).map((c) => (
                                  <div key={c.id} className="flex items-start gap-2 text-xs">
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium flex-shrink-0">QA #{c.qa_id}</span>
                                    <span className="text-slate-500">{c.field_name}:</span>
                                    {c.old_value && <span className="text-red-500 line-through truncate max-w-[120px]">{c.old_value.slice(0, 60)}</span>}
                                    <span className="text-slate-400">→</span>
                                    {c.new_value && <span className="text-emerald-600 truncate max-w-[120px]">{c.new_value.slice(0, 60)}</span>}
                                  </div>
                                ))}
                                {m.actions.corrections.length > 5 && (
                                  <p className="text-[10px] text-slate-400">+{m.actions.corrections.length - 5} more corrections</p>
                                )}
                              </div>
                            </div>
                          )}

                          {m.actions.behavioralCards.length > 0 && (
                            <div>
                              <div className="text-[10px] text-slate-500 font-medium mb-1">Behavioral Rules Created ({m.actions.behavioralCards.length}):</div>
                              <div className="space-y-1.5">
                                {m.actions.behavioralCards.map((bc) => (
                                  <div key={bc.id} className="bg-white border border-mint-200 rounded-lg px-2.5 py-1.5">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="text-xs font-medium text-mint-700">{bc.title}</span>
                                      <span className="px-1 py-0.5 rounded bg-mint-100 text-mint-600 text-[9px] font-medium">{bc.type}</span>
                                      <span className="px-1 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-medium">{bc.scope}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-600">{bc.instruction.slice(0, 150)}{bc.instruction.length > 150 ? "..." : ""}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Pending review — go to conversation */}
                      {m.rating === 1 && m.actions && m.actions.corrections.length === 0 && m.actions.behavioralCards.length === 0 && (
                        <div className="px-4 py-2.5 bg-amber-50/50 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertCircle size={11} />
                            <span>Pending review</span>
                          </div>
                          <button
                            onClick={() => {
                              setShowRatingsHistory(false);
                              setTab("agent");
                              setAgentSubTab("chat");
                              // Small delay to let tab switch render, then trigger conversation load
                              setTimeout(() => {
                                window.dispatchEvent(new CustomEvent("load-conversation", { detail: { conversationId: m.conversation_id } }));
                              }, 100);
                            }}
                            className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600 transition-colors"
                          >
                            <MessageCircle size={11} />
                            Review & Fix
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Settings Modal */}
      {showProfileSettings && user && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50" onClick={() => setShowProfileSettings(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">My Profile</h2>
              <button onClick={() => setShowProfileSettings(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {/* Display Name */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Display Name</label>
              <input
                value={profileDisplayName}
                onChange={(e) => setProfileDisplayName(e.target.value)}
                placeholder="Your display name"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-mint-400"
              />
            </div>

            {/* Calendly URL */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                <Link2 size={12} />Calendly Link
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5 mb-1">
                Your personal scheduling link. The AI agent will include this when suggesting meetings.
              </p>
              <input
                value={profileCalendlyUrl}
                onChange={(e) => setProfileCalendlyUrl(e.target.value)}
                placeholder="https://calendly.com/your-name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-mint-400"
              />
            </div>

            {/* Gmail Connection */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                <Mail size={12} />Gmail Connection
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
                Connect your Gmail to create email drafts from agent responses.
              </p>
              {user.gmail_connected ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs text-emerald-700 font-medium">{user.gmail_email || "Connected"}</span>
                  </div>
                  <button
                    onClick={disconnectGmail}
                    className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectGmail}
                  disabled={gmailConnecting}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {gmailConnecting ? (
                    <><RefreshCw size={14} className="animate-spin" />Connecting...</>
                  ) : (
                    <><Mail size={14} />Connect Gmail</>
                  )}
                </button>
              )}
            </div>

            {profileError && <p className="text-xs text-red-500">{profileError}</p>}

            <button
              onClick={saveProfile}
              disabled={profileSaving}
              className="w-full rounded-lg bg-mint-600 px-3 py-2 text-sm font-medium text-white hover:bg-mint-700 transition-colors disabled:opacity-50"
            >
              {profileSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* What's New Modal */}
      {showWhatsNew && (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50" onClick={() => {
          setShowWhatsNew(false);
          if (!completedTours.includes("whats-new-v2")) {
            fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourKey: "whats-new-v2" }) });
            setCompletedTours((prev) => [...prev, "whats-new-v2"]);
          }
        }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl mint-gradient flex items-center justify-center" style={{ boxShadow: "0 4px 14px rgba(51, 178, 156, 0.25)" }}>
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">What&apos;s New</h2>
                <p className="text-xs text-slate-400">Latest updates to your workspace</p>
              </div>
              <button onClick={() => {
                setShowWhatsNew(false);
                if (!completedTours.includes("whats-new-v2")) {
                  fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourKey: "whats-new-v2" }) });
                  setCompletedTours((prev) => [...prev, "whats-new-v2"]);
                }
              }} className="ml-auto p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {/* Features */}
            <div className="px-6 pb-6 space-y-4">
              {/* Calendly + Email Drafts */}
              <div className="flex gap-3 p-3 rounded-xl bg-mint-50/50 border border-mint-100">
                <div className="w-8 h-8 rounded-lg bg-mint-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Mail size={16} className="text-mint-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Calendly + Email Drafts</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Set your Calendly link in <strong>My Profile</strong> and the agent will include it when suggesting meetings.
                    Connect your Gmail to generate email drafts directly from any agent response.
                  </p>
                </div>
              </div>

              {/* Cleaner response layout */}
              <div className="flex gap-3 p-3 rounded-xl bg-violet-50/50 border border-violet-100">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BookOpen size={16} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Cleaner Response Layout</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    References are now collapsed by default behind a count badge. Stars, refs, email, and correction actions all sit on one compact bar.
                  </p>
                </div>
              </div>

              {/* PDF Upload */}
              <div className="flex gap-3 p-3 rounded-xl bg-amber-50/50 border border-amber-100">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Paperclip size={16} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">PDF Upload in Agent Chat</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Attach PDF reports directly to your questions using the paperclip button. The agent will extract and analyze the content alongside your knowledge base.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => {
                  setShowWhatsNew(false);
                  if (!completedTours.includes("whats-new-v2")) {
                    fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourKey: "whats-new-v2" }) });
                    setCompletedTours((prev) => [...prev, "whats-new-v2"]);
                  }
                }}
                className="w-full px-4 py-2.5 text-sm font-bold text-white rounded-xl mint-gradient hover:opacity-90 transition-opacity"
                style={{ boxShadow: "0 4px 14px rgba(51, 178, 156, 0.25)" }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
