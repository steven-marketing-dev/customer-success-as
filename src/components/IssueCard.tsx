"use client";

import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, MousePointerClick, MessageCircle, CheckCircle2, Tag } from "lucide-react";

export interface IssueCardLinkedUrl {
  page: string;
  pathname: string;
  friction_total: number;
  rage_clicks: number;
  dead_clicks: number;
  js_errors: number;
  quick_back: number;
}

export interface IssueCardEntity {
  name: string;
  doc_count: number;
  share_pct: number;
}

export interface IssueCardData {
  category_id: number;
  category_name: string;
  count: number;
  prev_count: number;
  trend: "up" | "down" | "flat";
  last_seen: number;
  top_root_cause: string | null;
  resolved_pct: number;
  distinct_companies: number;
  top_companies: Array<{ company_name: string; ticket_count: number; at_risk: boolean }>;
  sample_questions: string[];
  linked_urls: IssueCardLinkedUrl[];
  top_entities: IssueCardEntity[];
  recommendation: string;
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
  ui_friction: "#f59e0b",
  onboarding_gap: "#8b5cf6",
  platform_bug: "#ef4444",
  feature_request: "#3b82f6",
  how_to: "#10b981",
  billing: "#ec4899",
  other: "#94a3b8",
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function deltaPct(count: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((count - prev) / prev) * 100);
}

/** Render a recommendation string with markdown-style **bold** segments. */
function RenderRecommendation({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-warm-900">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function IssueCard({
  data,
  onOpenCustomer,
}: {
  data: IssueCardData;
  onOpenCustomer: (companyName: string) => void;
}) {
  const rcKey = data.top_root_cause ?? "other";
  const rcColor = ROOT_CAUSE_COLOR[rcKey] ?? ROOT_CAUSE_COLOR.other;
  const rcLabel = ROOT_CAUSE_LABEL[rcKey] ?? "Other";
  const delta = deltaPct(data.count, data.prev_count);

  return (
    <article className="card-warm p-5 space-y-4">
      {/* Header: name + trend + root-cause chip */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-bold text-warm-800 truncate">
            {data.category_name}
          </h3>
          <div className="flex items-center gap-2 text-xs text-warm-500 mt-0.5">
            <span className="font-display font-semibold text-warm-800 text-base">
              {data.count}
            </span>
            <span>tickets</span>
            {data.trend === "up" && (
              <span className="inline-flex items-center gap-0.5 text-amber-600">
                <ArrowUpRight size={12} />
                {delta !== null ? `+${delta}%` : "new"}
              </span>
            )}
            {data.trend === "down" && (
              <span className="inline-flex items-center gap-0.5 text-emerald-600">
                <ArrowDownRight size={12} />
                {delta !== null ? `${delta}%` : ""}
              </span>
            )}
            {data.trend === "flat" && (
              <span className="inline-flex items-center gap-0.5 text-warm-400">
                <Minus size={12} /> stable
              </span>
            )}
            <span className="text-warm-300">·</span>
            <span>{timeAgo(data.last_seen)}</span>
          </div>
        </div>

        <span
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium"
          style={{ backgroundColor: `${rcColor}1A`, color: rcColor }}
        >
          {rcLabel}
        </span>
      </header>

      {/* Top mentions — cross-cutting entities (Indeed, LinkedIn, etc.) */}
      {data.top_entities.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Tag size={12} className="text-warm-400 flex-shrink-0" />
          <span className="text-warm-500 uppercase tracking-wide text-[10px] font-semibold">Top mentions</span>
          {data.top_entities.map((ent) => {
            const isDominant = ent.share_pct >= 30;
            return (
              <span
                key={ent.name}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] ${
                  isDominant
                    ? "bg-amber-50 text-amber-700 font-semibold border border-amber-200"
                    : "bg-warm-100 text-warm-700"
                }`}
                title={`Mentioned in ${ent.doc_count} of ${data.count} tickets (${ent.share_pct}%)`}
              >
                <span>{ent.name}</span>
                <span className={isDominant ? "text-amber-600" : "text-warm-500"}>
                  {ent.doc_count}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* Resolved % bar */}
      <div className="flex items-center gap-3 text-xs">
        <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
        <span className="text-warm-500">Resolved</span>
        <div className="flex-1 h-1.5 bg-warm-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${data.resolved_pct}%` }}
          />
        </div>
        <span className="font-display font-semibold text-warm-700 tabular-nums">
          {data.resolved_pct}%
        </span>
      </div>

      {/* Recommendation — the headline action */}
      <div className="rounded-lg bg-mint-50 border border-mint-200 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide text-mint-700 font-semibold mb-1">
          Suggested action
        </p>
        <p className="text-sm text-warm-800 leading-snug">
          <RenderRecommendation text={data.recommendation} />
        </p>
      </div>

      {/* Two-column: questions + customers + URLs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* What customers are asking */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-warm-500 font-semibold flex items-center gap-1">
            <MessageCircle size={11} /> What customers are asking
          </p>
          {data.sample_questions.length === 0 ? (
            <p className="text-xs text-warm-400">(no questions captured)</p>
          ) : (
            <ul className="space-y-1.5">
              {data.sample_questions.map((q, i) => (
                <li key={i} className="text-xs text-warm-700 leading-snug border-l-2 border-warm-200 pl-2">
                  &ldquo;{q.length > 140 ? q.slice(0, 140) + "…" : q}&rdquo;
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Affected customers + linked URLs */}
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-warm-500 font-semibold">
              Affected customers ({data.distinct_companies})
            </p>
            {data.top_companies.length === 0 ? (
              <p className="text-xs text-warm-400">(no customer info — run customer-info backfill)</p>
            ) : (
              <ul className="space-y-1">
                {data.top_companies.map((c) => (
                  <li key={c.company_name}>
                    <button
                      onClick={() => onOpenCustomer(c.company_name)}
                      className="w-full flex items-center gap-2 text-left text-xs text-warm-700 hover:text-warm-900 hover:bg-warm-50 rounded px-1.5 py-1 -mx-1.5"
                    >
                      <span className="flex-1 truncate">{c.company_name}</span>
                      <span className="text-warm-400 tabular-nums">{c.ticket_count}</span>
                      {c.at_risk && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium">
                          <AlertTriangle size={9} /> at risk
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.linked_urls.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-warm-500 font-semibold">
                Likely linked pages (Clarity)
              </p>
              <ul className="space-y-1">
                {data.linked_urls.map((u) => (
                  <li
                    key={u.page}
                    className="flex items-center gap-2 text-xs text-warm-700 bg-warm-50/60 rounded px-2 py-1"
                    title={u.page}
                  >
                    <MousePointerClick size={11} className="text-warm-400 flex-shrink-0" />
                    <span className="flex-1 truncate font-mono text-[11px]">{u.pathname}</span>
                    <span className="text-warm-500 tabular-nums">
                      {u.friction_total} friction
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
