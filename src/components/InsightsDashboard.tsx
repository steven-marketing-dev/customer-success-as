"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Ticket, MessageSquare, Repeat2, Users, ArrowUpRight, ArrowDownRight, X, AlertTriangle, MousePointerClick, RefreshCw, Zap, Sparkles, ChevronDown } from "lucide-react";
import { IssueCard, type IssueCardData } from "./IssueCard";

type Range = "7d" | "30d" | "90d" | "all";

interface InsightStats {
  tickets: number;
  qa_pairs: number;
  resolved_pct: number;
  prev_tickets: number;
  recurring_share_pct: number;
  at_risk_count: number;
}

interface RecurringIssue {
  template: string;
  count: number;
  last_seen: number;
  sample_question: string;
  category_name: string | null;
  root_cause: string | null;
}

interface RootCauseRow {
  root_cause: string;
  count: number;
}

interface RootCauseTrendRow {
  date_bucket: string;
  root_cause: string;
  count: number;
}

interface AtRiskCustomer {
  company_name: string;
  contact_emails: string[];
  ticket_count: number;
  how_to_pct: number;
  onboarding_gap_pct: number;
  last_ticket_at: number;
  suggest_onboarding: boolean;
}

interface UxHotspot {
  page: string;
  traffic: number;
  rage_clicks: number;
  dead_clicks: number;
  js_errors: number;
  quick_back: number;
  friction_total: number;
}

interface InsightsResponse {
  range: Range;
  stats: InsightStats;
  recurring: RecurringIssue[];
  issue_cards: IssueCardData[];
  executive_summary: string | null;
  root_cause_breakdown: RootCauseRow[];
  root_cause_trend: RootCauseTrendRow[];
  at_risk_customers: AtRiskCustomer[];
  ux_hotspots: UxHotspot[];
  clarity_configured: boolean;
}

const ROOT_CAUSE_LABEL: Record<string, string> = {
  ui_friction: "UI friction",
  onboarding_gap: "Onboarding gap",
  platform_bug: "Platform bug",
  feature_request: "Feature request",
  how_to: "How-to",
  billing: "Billing",
  other: "Other",
};

const ROOT_CAUSE_COLOR: Record<string, string> = {
  ui_friction: "#f59e0b",       // amber-500
  onboarding_gap: "#8b5cf6",    // violet-500
  platform_bug: "#ef4444",      // red-500
  feature_request: "#3b82f6",   // blue-500
  how_to: "#10b981",            // emerald-500
  billing: "#ec4899",           // pink-500
  other: "#94a3b8",             // slate-400
};

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function slugify(name: string): string {
  // base64url-encode UTF-8 bytes — matches Buffer.from(slug, "base64url") on the server
  const bytes = new TextEncoder().encode(name);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface CustomerDrawerData {
  company: string;
  contacts: Array<{ contact_email: string | null; contact_name: string | null }>;
  tickets: Array<{
    id: number;
    hubspot_id: string;
    subject: string | null;
    hubspot_created_at: number | null;
    qa_root_causes: string[];
  }>;
  root_cause_distribution: RootCauseRow[];
  recommendation: string;
}

export function InsightsDashboard({ userRole }: { userRole: string | null }) {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<CustomerDrawerData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showAllAtRisk, setShowAllAtRisk] = useState(false);
  const [showAllHotspots, setShowAllHotspots] = useState(false);
  const [claritySyncing, setClaritySyncing] = useState(false);
  const [claritySyncMsg, setClaritySyncMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/insights?range=${range}`);
      const d = await res.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCustomer = useCallback(async (companyName: string) => {
    setDrawer({ company: companyName, contacts: [], tickets: [], root_cause_distribution: [], recommendation: "" });
    setDrawerLoading(true);
    try {
      const slug = slugify(companyName);
      const res = await fetch(`/api/dashboard/customer/${slug}?range=${range}`);
      const d = await res.json();
      setDrawer(d);
    } catch {
      setDrawer(null);
    } finally {
      setDrawerLoading(false);
    }
  }, [range]);

  const syncClarity = useCallback(async () => {
    setClaritySyncing(true);
    setClaritySyncMsg(null);
    try {
      const res = await fetch("/api/dashboard/clarity/sync", { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        setClaritySyncMsg(`✓ ${d.rows_upserted ?? 0} rows synced.`);
        fetchData();
      } else {
        setClaritySyncMsg(`Failed: ${d.error ?? res.statusText}`);
      }
    } catch (err) {
      setClaritySyncMsg(`Failed: ${err}`);
    } finally {
      setClaritySyncing(false);
    }
  }, [fetchData]);

  const visibleIssues = useMemo(() => {
    if (!data) return [];
    return showAllIssues ? data.issue_cards : data.issue_cards.slice(0, 6);
  }, [data, showAllIssues]);

  const visibleAtRisk = useMemo(() => {
    if (!data) return [];
    return showAllAtRisk ? data.at_risk_customers : data.at_risk_customers.slice(0, 5);
  }, [data, showAllAtRisk]);

  const visibleHotspots = useMemo(() => {
    if (!data) return [];
    return showAllHotspots ? data.ux_hotspots : data.ux_hotspots.slice(0, 5);
  }, [data, showAllHotspots]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-mint-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const delta = data.stats.tickets - data.stats.prev_tickets;
  const deltaPct = data.stats.prev_tickets > 0
    ? Math.round((delta / data.stats.prev_tickets) * 100)
    : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Insights</h1>
          <p className="text-sm text-slate-500">Why tickets keep arriving — and which customers need attention.</p>
        </div>
        <div className="flex gap-1 bg-warm-100 rounded-xl p-1">
          {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r ? "bg-white text-warm-800 shadow-sm" : "text-warm-500 hover:text-warm-700"
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Ticket size={20} />}
          iconBg="bg-mint-50" iconColor="text-mint-500"
          value={data.stats.tickets.toLocaleString()}
          label="Tickets"
          delta={range === "all" ? null : { value: delta, pct: deltaPct }}
        />
        <StatCard
          icon={<MessageSquare size={20} />}
          iconBg="bg-blue-50" iconColor="text-blue-500"
          value={`${data.stats.resolved_pct}%`}
          label={`Resolved (${data.stats.qa_pairs} Q&A)`}
        />
        <StatCard
          icon={<Repeat2 size={20} />}
          iconBg="bg-violet-50" iconColor="text-violet-500"
          value={`${data.stats.recurring_share_pct}%`}
          label="Recurring share"
        />
        <StatCard
          icon={<Users size={20} />}
          iconBg="bg-amber-50" iconColor="text-amber-500"
          value={data.stats.at_risk_count.toString()}
          label="At-risk customers"
        />
      </div>

      {/* Executive summary — AI-generated narrative of top 3 issues */}
      {data.executive_summary && (
        <div className="card-warm p-5 border-l-4 border-l-mint-500 bg-gradient-to-br from-mint-50/40 to-white">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-mint-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wide text-mint-700 font-semibold mb-1">
                This {range === "all" ? "period" : range.replace("d", "-day window")}
              </p>
              <p className="text-sm text-warm-800 leading-relaxed">{data.executive_summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Issue Cards — synthesized story per topic */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Top issues</h2>
          {data.issue_cards.length > 0 && (
            <span className="text-xs text-warm-400">{data.issue_cards.length} active</span>
          )}
        </div>
        {data.issue_cards.length === 0 ? (
          <div className="card-warm p-8 text-center">
            <p className="text-sm text-warm-500">
              No category has three or more Q&amp;A in this window. Try widening the range.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleIssues.map((card) => (
              <IssueCard key={card.category_id} data={card} onOpenCustomer={openCustomer} />
            ))}
            {data.issue_cards.length > 6 && (
              <button
                onClick={() => setShowAllIssues(!showAllIssues)}
                className="w-full py-2.5 text-sm text-mint-600 hover:bg-mint-50/50 rounded-xl border border-warm-200 hover:border-mint-300 transition-colors"
              >
                {showAllIssues ? "Show fewer" : `Show ${data.issue_cards.length - 6} more`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* At-risk customers — compact */}
      <section>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">At-risk customers</h2>
        <div className="card-warm overflow-hidden">
          {data.at_risk_customers.length === 0 ? (
            <p className="text-sm text-warm-500 p-5">No customer info available yet — run the &quot;Backfill customer info&quot; pipeline action to populate.</p>
          ) : (
            <>
              <ul className="divide-y divide-warm-100">
                {visibleAtRisk.map((c) => (
                  <li key={c.company_name}>
                    <button
                      onClick={() => openCustomer(c.company_name)}
                      className="w-full flex items-center gap-4 px-5 py-3 hover:bg-warm-50/50 text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-semibold text-warm-800 truncate">{c.company_name}</p>
                        <p className="text-xs text-warm-500 truncate">
                          {c.contact_emails.slice(0, 2).join(", ")}{c.contact_emails.length > 2 ? ` +${c.contact_emails.length - 2}` : ""}
                        </p>
                      </div>
                      <div className="text-right text-xs text-warm-500 hidden sm:block">
                        <span className="font-display font-bold text-warm-800 text-base">{c.ticket_count}</span> tickets
                      </div>
                      <div className="hidden md:flex flex-col gap-0.5 text-[11px] text-warm-500">
                        <span>How-to: <strong className="text-warm-700">{c.how_to_pct}%</strong></span>
                        <span>Onboarding: <strong className="text-warm-700">{c.onboarding_gap_pct}%</strong></span>
                      </div>
                      {c.suggest_onboarding && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[11px] font-medium">
                          <AlertTriangle size={12} /> Suggest onboarding
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {data.at_risk_customers.length > 5 && (
                <button
                  onClick={() => setShowAllAtRisk(!showAllAtRisk)}
                  className="w-full py-2 text-xs text-mint-600 hover:bg-mint-50/50 border-t border-warm-100"
                >
                  {showAllAtRisk ? "Show fewer" : `Show ${data.at_risk_customers.length - 5} more`}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* UX hotspots from Clarity — compact */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">UX hotspots <span className="text-warm-400 normal-case font-normal">(Microsoft Clarity)</span></h2>
          {data.clarity_configured && userRole === "master" && (
            <button
              onClick={syncClarity}
              disabled={claritySyncing}
              className="inline-flex items-center gap-1.5 text-xs text-mint-600 hover:text-mint-800 disabled:opacity-50"
            >
              <RefreshCw size={12} className={claritySyncing ? "animate-spin" : ""} /> Sync now
            </button>
          )}
        </div>
        {claritySyncMsg && <p className="text-xs text-warm-500 mb-2">{claritySyncMsg}</p>}
        <div className="card-warm p-5">
          {!data.clarity_configured ? (
            <div className="flex items-start gap-3">
              <Zap size={20} className="text-warm-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-display font-semibold text-warm-800 mb-1">Connect Microsoft Clarity</p>
                <p className="text-sm text-warm-500 mb-2">
                  Set <code className="text-xs bg-warm-100 px-1 py-0.5 rounded">CLARITY_PROJECT_ID</code> and <code className="text-xs bg-warm-100 px-1 py-0.5 rounded">CLARITY_API_TOKEN</code> in your environment to surface friction hotspots (rage clicks, dead clicks, JS errors) per page.
                </p>
                <p className="text-xs text-warm-400">Requires a paid Clarity plan with Data Export API access.</p>
              </div>
            </div>
          ) : data.ux_hotspots.length === 0 ? (
            <p className="text-sm text-warm-500">No Clarity data yet. {userRole === "master" ? "Click \"Sync now\" to fetch yesterday's metrics." : "Ask an admin to sync the Clarity data."}</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-warm-500">
                  <tr>
                    <th className="text-left py-2 pr-3 font-medium">Page</th>
                    <th className="text-right py-2 px-3 font-medium">Rage</th>
                    <th className="text-right py-2 px-3 font-medium">Dead</th>
                    <th className="text-right py-2 px-3 font-medium">Errors</th>
                    <th className="text-right py-2 px-3 font-medium">Quick back</th>
                    <th className="text-right py-2 pl-3 font-medium">Total friction</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHotspots.map((h) => (
                    <tr key={h.page} className="border-t border-warm-100">
                      <td className="py-2 pr-3 text-warm-800 max-w-sm truncate" title={h.page}>
                        <MousePointerClick size={12} className="inline mr-1 text-warm-400" />
                        {h.page}
                      </td>
                      <td className="py-2 px-3 text-right text-warm-700">{h.rage_clicks}</td>
                      <td className="py-2 px-3 text-right text-warm-700">{h.dead_clicks}</td>
                      <td className="py-2 px-3 text-right text-warm-700">{h.js_errors}</td>
                      <td className="py-2 px-3 text-right text-warm-700">{h.quick_back}</td>
                      <td className="py-2 pl-3 text-right font-display font-semibold text-warm-800">{h.friction_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.ux_hotspots.length > 5 && (
                <button
                  onClick={() => setShowAllHotspots(!showAllHotspots)}
                  className="w-full mt-2 py-1.5 text-xs text-mint-600 hover:bg-mint-50/50 rounded"
                >
                  {showAllHotspots ? "Show fewer" : `Show ${data.ux_hotspots.length - 5} more`}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* Trends — collapsible (root cause donut + weekly bars) */}
      {data.root_cause_breakdown.length > 0 && (
        <details className="card-warm group">
          <summary className="cursor-pointer list-none flex items-center justify-between px-5 py-3 hover:bg-warm-50/50 rounded-xl">
            <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Trends</span>
            <ChevronDown size={16} className="text-warm-400 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="px-5 pb-5 pt-2 space-y-4 border-t border-warm-100">
            <StackedBar rows={data.root_cause_breakdown} />
            <Legend rows={data.root_cause_breakdown} />
            {data.root_cause_trend.length > 0 && (
              <div className="pt-4 border-t border-warm-200">
                <p className="text-xs text-warm-500 mb-2 uppercase tracking-wide">Weekly trend by root cause</p>
                <TrendBars trend={data.root_cause_trend} />
              </div>
            )}
          </div>
        </details>
      )}

      {/* Customer drawer */}
      {drawer && (
        <CustomerDrawer
          data={drawer}
          loading={drawerLoading}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, iconColor, value, label, delta }: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  delta?: { value: number; pct: number | null } | null;
}) {
  return (
    <div className="card-warm p-5 flex items-center gap-4 fade-up">
      <div className={`p-2.5 rounded-xl ${iconBg} ${iconColor}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-display text-2xl font-bold text-warm-800">{value}</p>
        <p className="text-sm text-warm-500 truncate">{label}</p>
        {delta && delta.value !== 0 && (
          <p className={`text-xs flex items-center gap-0.5 mt-0.5 ${
            delta.value > 0 ? "text-amber-600" : "text-emerald-600"
          }`}>
            {delta.value > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta.value)}{delta.pct !== null ? ` (${delta.pct > 0 ? "+" : ""}${delta.pct}%)` : ""} vs prior
          </p>
        )}
      </div>
    </div>
  );
}

function RootCauseChip({ cause }: { cause: string | null }) {
  const key = cause ?? "other";
  const color = ROOT_CAUSE_COLOR[key] ?? ROOT_CAUSE_COLOR.other;
  const label = ROOT_CAUSE_LABEL[key] ?? "Other";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      {label}
    </span>
  );
}

function StackedBar({ rows }: { rows: RootCauseRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-6 rounded-md overflow-hidden bg-warm-100">
      {rows.map((r) => {
        const pct = (r.count / total) * 100;
        return (
          <div
            key={r.root_cause}
            style={{ width: `${pct}%`, backgroundColor: ROOT_CAUSE_COLOR[r.root_cause] ?? ROOT_CAUSE_COLOR.other }}
            title={`${ROOT_CAUSE_LABEL[r.root_cause] ?? r.root_cause}: ${r.count} (${pct.toFixed(0)}%)`}
          />
        );
      })}
    </div>
  );
}

function Legend({ rows }: { rows: RootCauseRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <div key={r.root_cause} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: ROOT_CAUSE_COLOR[r.root_cause] ?? ROOT_CAUSE_COLOR.other }}
            />
            <span className="text-warm-700">{ROOT_CAUSE_LABEL[r.root_cause] ?? r.root_cause}</span>
            <span className="text-warm-400">{r.count} ({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendBars({ trend }: { trend: RootCauseTrendRow[] }) {
  // Group by date_bucket
  const buckets = new Map<string, Map<string, number>>();
  let maxBucketTotal = 0;
  for (const row of trend) {
    let m = buckets.get(row.date_bucket);
    if (!m) {
      m = new Map();
      buckets.set(row.date_bucket, m);
    }
    m.set(row.root_cause, row.count);
  }
  for (const m of buckets.values()) {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    if (total > maxBucketTotal) maxBucketTotal = total;
  }
  if (maxBucketTotal === 0) return null;

  const sortedBuckets = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  const causes = Object.keys(ROOT_CAUSE_COLOR);

  return (
    <div className="flex items-end gap-1 h-24">
      {sortedBuckets.map(([date, m]) => {
        const total = [...m.values()].reduce((s, v) => s + v, 0);
        const heightPct = (total / maxBucketTotal) * 100;
        return (
          <div
            key={date}
            className="flex-1 flex flex-col-reverse min-w-[12px]"
            style={{ height: `${heightPct}%` }}
            title={`${date}: ${total}`}
          >
            {causes.map((c) => {
              const v = m.get(c) ?? 0;
              if (v === 0) return null;
              const segPct = (v / total) * 100;
              return (
                <div
                  key={c}
                  style={{ height: `${segPct}%`, backgroundColor: ROOT_CAUSE_COLOR[c] }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CustomerDrawer({ data, loading, onClose }: {
  data: CustomerDrawerData;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[560px] bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-warm-100 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-warm-500">Customer</p>
            <h3 className="font-display text-lg font-bold text-warm-800">{data.company}</h3>
          </div>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600 p-1">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-mint-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Contacts */}
            {data.contacts.length > 0 && (
              <div>
                <p className="text-xs uppercase text-warm-500 mb-2">Contacts</p>
                <ul className="space-y-1 text-sm">
                  {data.contacts.map((c, i) => (
                    <li key={i} className="text-warm-700">
                      {c.contact_name && <span className="font-medium">{c.contact_name} </span>}
                      <span className="text-warm-500">&lt;{c.contact_email}&gt;</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendation */}
            <div className="rounded-lg bg-mint-50 border border-mint-200 p-3">
              <p className="text-xs uppercase tracking-wide text-mint-700 mb-1">Recommendation</p>
              <p className="text-sm text-warm-800">{data.recommendation}</p>
            </div>

            {/* Distribution */}
            {data.root_cause_distribution.length > 0 && (
              <div>
                <p className="text-xs uppercase text-warm-500 mb-2">Root cause mix</p>
                <StackedBar rows={data.root_cause_distribution} />
                <div className="mt-2"><Legend rows={data.root_cause_distribution} /></div>
              </div>
            )}

            {/* Tickets */}
            <div>
              <p className="text-xs uppercase text-warm-500 mb-2">Recent tickets ({data.tickets.length})</p>
              {data.tickets.length === 0 ? (
                <p className="text-sm text-warm-500">No tickets in window.</p>
              ) : (
                <ul className="space-y-2">
                  {data.tickets.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-sm border-l-2 border-warm-200 pl-3 py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-warm-800 truncate">{t.subject ?? "(no subject)"}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.qa_root_causes.map((rc, i) => (
                            <RootCauseChip key={i} cause={rc} />
                          ))}
                        </div>
                      </div>
                      <span className="text-xs text-warm-500 flex-shrink-0">{timeAgo(t.hubspot_created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
