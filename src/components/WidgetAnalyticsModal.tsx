"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Loader2, MessageSquare, MousePointerClick, Star, Activity, ExternalLink, ChevronDown, ChevronRight, Download, BookOpen, Calendar, Mail } from "lucide-react";

interface AnalyticsData {
  installation: { id: number; name: string; product_name: string | null };
  range: { days: number; since: number };
  top_questions: Array<{ question_norm: string; sample_question: string; count: number; last_asked_at: number }>;
  top_article_clicks: Array<{ article_url: string; article_title: string; clicks: number; last_clicked_at: number }>;
  rating_breakdown: { total: number; avg: number | null; by_rating: { 1: number; 2: number; 3: number } };
  ratings_feed: Array<{
    id: number;
    rating: 1 | 2 | 3;
    feedback: string | null;
    question: string;
    answer: string;
    created_at: number;
  }>;
  volume_by_day: Array<{ day: string; questions: number; ratings: number; clicks: number }>;
  menu_actions: {
    totals: Record<string, number>;
    uniques: Record<string, number>;
    daily: Array<{ date: string; counts: Record<string, number> }>;
    topSourceUrls: Array<{ url: string; count: number }>;
  };
}

const RANGE_OPTIONS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const RATING_LABELS: Record<1 | 2 | 3, { text: string; pill: string }> = {
  1: { text: "Not helpful", pill: "bg-red-100 text-red-700 border-red-200" },
  2: { text: "OK", pill: "bg-amber-100 text-amber-700 border-amber-200" },
  3: { text: "Great", pill: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

function formatRelative(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function WidgetAnalyticsModal({
  installationId,
  onClose,
}: {
  installationId: number;
  onClose: () => void;
}) {
  const [days, setDays] = useState(30);
  const [ratingFilter, setRatingFilter] = useState<1 | 2 | 3 | null>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (ratingFilter) params.set("rating", String(ratingFilter));
      const res = await fetch(`/api/widget-installations/${installationId}/analytics?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    }
    setLoading(false);
  }, [installationId, days, ratingFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0C1222] tracking-tight">
              Widget Analytics{data?.installation.name ? ` · ${data.installation.name}` : ""}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Top questions, article clicks, ratings and volume — last {days} days.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    days === r.days ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <a
              href={`/widget-installations/${installationId}/report?days=${days}${ratingFilter ? `&rating=${ratingFilter}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-mint-700 hover:border-mint-300 whitespace-nowrap"
              title="Open printable report in a new tab"
            >
              <Download size={12} />Export PDF
            </a>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {loading && !data ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : data ? (
            <>
              <VolumePanel data={data} />

              <MenuActionsPanel data={data} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TopQuestionsPanel data={data} />
                <TopClicksPanel data={data} />
              </div>

              <RatingsPanel
                data={data}
                ratingFilter={ratingFilter}
                onRatingFilterChange={setRatingFilter}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VolumePanel({ data }: { data: AnalyticsData }) {
  const max = useMemo(() => {
    let m = 0;
    for (const d of data.volume_by_day) {
      m = Math.max(m, d.questions, d.ratings, d.clicks);
    }
    return m || 1;
  }, [data.volume_by_day]);

  const totals = useMemo(() => {
    return data.volume_by_day.reduce(
      (acc, d) => {
        acc.questions += d.questions;
        acc.ratings += d.ratings;
        acc.clicks += d.clicks;
        return acc;
      },
      { questions: 0, ratings: 0, clicks: 0 },
    );
  }, [data.volume_by_day]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <Activity size={14} className="text-slate-400" />
            Daily volume
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Questions asked, ratings submitted, and article clicks per day.
          </p>
        </div>
        <div className="flex gap-3 text-[11px]">
          <Total label="Questions" value={totals.questions} dot="bg-slate-700" />
          <Total label="Ratings" value={totals.ratings} dot="bg-amber-400" />
          <Total label="Clicks" value={totals.clicks} dot="bg-mint-500" />
        </div>
      </div>
      <div className="flex items-end gap-0.5 h-24">
        {data.volume_by_day.length === 0 ? (
          <p className="text-xs text-slate-400 self-center mx-auto">No activity yet.</p>
        ) : (
          data.volume_by_day.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col justify-end gap-px h-full" title={`${d.day} · ${d.questions} Q · ${d.ratings} R · ${d.clicks} C`}>
              <div
                className="bg-slate-700 rounded-t-sm"
                style={{ height: `${(d.questions / max) * 100}%` }}
              />
              <div
                className="bg-amber-400"
                style={{ height: `${(d.ratings / max) * 100}%` }}
              />
              <div
                className="bg-mint-500 rounded-b-sm"
                style={{ height: `${(d.clicks / max) * 100}%` }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Total({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-600">
      <span className={`w-2 h-2 rounded-sm ${dot}`} />
      <strong className="text-slate-800">{value}</strong>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

function TopQuestionsPanel({ data }: { data: AnalyticsData }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 mb-3">
        <MessageSquare size={14} className="text-slate-400" />
        Top questions
        <span className="text-xs font-normal text-slate-400">({data.top_questions.length})</span>
      </h3>
      {data.top_questions.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">
          No questions yet in this window. New questions will appear here as users chat with the widget.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.top_questions.map((q) => (
            <li key={q.question_norm} className="flex items-start gap-2 text-sm">
              <span className="flex-shrink-0 w-7 h-6 rounded bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center">
                {q.count}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800 leading-snug line-clamp-2">{q.sample_question}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">last {formatRelative(q.last_asked_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopClicksPanel({ data }: { data: AnalyticsData }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 mb-3">
        <MousePointerClick size={14} className="text-slate-400" />
        Most-clicked articles
        <span className="text-xs font-normal text-slate-400">({data.top_article_clicks.length})</span>
      </h3>
      {data.top_article_clicks.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">
          No article clicks yet. Clicks are tracked when a user opens an article link from a widget answer.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.top_article_clicks.map((a) => (
            <li key={a.article_url} className="flex items-start gap-2 text-sm">
              <span className="flex-shrink-0 w-7 h-6 rounded bg-mint-50 text-mint-700 text-xs font-semibold flex items-center justify-center">
                {a.clicks}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={a.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-800 hover:text-mint-700 inline-flex items-center gap-1 leading-snug line-clamp-2"
                >
                  <span className="truncate">{a.article_title}</span>
                  <ExternalLink size={10} className="flex-shrink-0 text-slate-400" />
                </a>
                <p className="text-[10px] text-slate-400 mt-0.5">last {formatRelative(a.last_clicked_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RatingsPanel({
  data,
  ratingFilter,
  onRatingFilterChange,
}: {
  data: AnalyticsData;
  ratingFilter: 1 | 2 | 3 | null;
  onRatingFilterChange: (r: 1 | 2 | 3 | null) => void;
}) {
  const { rating_breakdown: br } = data;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <Star size={14} className="text-slate-400" />
            Ratings feed
            <span className="text-xs font-normal text-slate-400">({data.ratings_feed.length})</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Each rated answer, with the question and feedback the user left. Click to expand the answer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-600">
            Avg <strong className="text-slate-800">{br.avg != null ? br.avg.toFixed(2) : "—"}</strong>
            <span className="text-slate-400"> / 3 · {br.total} total</span>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <FilterChip
              label={`All ${br.total > 0 ? `(${br.total})` : ""}`}
              active={ratingFilter === null}
              onClick={() => onRatingFilterChange(null)}
            />
            <FilterChip
              label={`★ Bad (${br.by_rating[1]})`}
              active={ratingFilter === 1}
              tone="red"
              onClick={() => onRatingFilterChange(1)}
            />
            <FilterChip
              label={`★★ OK (${br.by_rating[2]})`}
              active={ratingFilter === 2}
              tone="amber"
              onClick={() => onRatingFilterChange(2)}
            />
            <FilterChip
              label={`★★★ Good (${br.by_rating[3]})`}
              active={ratingFilter === 3}
              tone="emerald"
              onClick={() => onRatingFilterChange(3)}
            />
          </div>
        </div>
      </div>

      {data.ratings_feed.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">
          No ratings match this filter. Try widening the time range or selecting a different rating.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.ratings_feed.map((r) => (
            <RatingRow key={r.id} item={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({
  label, active, tone, onClick,
}: { label: string; active: boolean; tone?: "red" | "amber" | "emerald"; onClick: () => void }) {
  const activeTone =
    tone === "red" ? "bg-red-100 text-red-700"
    : tone === "amber" ? "bg-amber-100 text-amber-700"
    : tone === "emerald" ? "bg-emerald-100 text-emerald-700"
    : "bg-white text-slate-800 shadow-sm";
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded font-medium whitespace-nowrap ${active ? activeTone : "text-slate-500 hover:text-slate-700"}`}
    >
      {label}
    </button>
  );
}

function RatingRow({ item }: { item: AnalyticsData["ratings_feed"][number] }) {
  const [open, setOpen] = useState(false);
  const meta = RATING_LABELS[item.rating];
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-100/60 rounded-lg"
      >
        {open
          ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
          : <ChevronRight size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />}
        <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${meta.pill}`}>
          {"★".repeat(item.rating)} {meta.text}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-800 leading-snug line-clamp-2">{item.question}</p>
          {item.feedback && (
            <p className="text-xs text-slate-600 italic mt-1 line-clamp-2">“{item.feedback}”</p>
          )}
        </div>
        <span className="flex-shrink-0 text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
          {formatRelative(item.created_at)}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-200 bg-white rounded-b-lg">
          <Field label="Question" value={item.question} />
          <Field label="Answer shown" value={item.answer} multiline />
          {item.feedback && <Field label="User feedback" value={item.feedback} multiline />}
        </div>
      )}
    </li>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">{label}</p>
      <p className={`text-xs text-slate-700 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</p>
    </div>
  );
}

function MenuActionsPanel({ data }: { data: AnalyticsData }) {
  const ma = data.menu_actions;
  const tiles: Array<{ key: string; label: string; icon: typeof BookOpen; tone: string }> = [
    { key: "kb_click", label: "KB clicks", icon: BookOpen, tone: "bg-cyan-50 text-cyan-700 border-cyan-200" },
    { key: "calendly_click", label: "Calendly clicks", icon: Calendar, tone: "bg-violet-50 text-violet-700 border-violet-200" },
    { key: "email_submit", label: "Email submits", icon: Mail, tone: "bg-mint-50 text-mint-700 border-mint-200" },
  ];
  const anyActivity = tiles.some((t) => (ma.totals[t.key] ?? 0) > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <MousePointerClick size={14} className="text-slate-400" />
            Menu actions
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Clicks on the help-menu options and email-form submissions. Uniques are counted per hashed IP.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {tiles.map((t) => {
          const total = ma.totals[t.key] ?? 0;
          const unique = ma.uniques[t.key] ?? 0;
          const Icon = t.icon;
          return (
            <div key={t.key} className={`rounded-lg border px-3 py-2.5 ${t.tone}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
                <Icon size={12} />{t.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tabular-nums">{total}</span>
                <span className="text-[11px] opacity-70">{unique} unique{unique === 1 ? "" : "s"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {ma.topSourceUrls.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Top source pages</p>
          <ul className="space-y-1">
            {ma.topSourceUrls.map((s) => (
              <li key={s.url} className="flex items-center gap-2 text-xs">
                <span className="flex-shrink-0 w-7 h-5 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center tabular-nums">
                  {s.count}
                </span>
                <span className="truncate text-slate-700 font-mono text-[11px]" title={s.url}>{s.url}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!anyActivity && (
        <p className="text-xs text-slate-400 py-4 text-center">
          No menu-action clicks recorded yet for this window. Counts appear here as users click Knowledge Base, Schedule a Meeting, or submit the email form.
        </p>
      )}
    </section>
  );
}

