"use client";

import { Ticket, MessageSquare, Tag, Clock } from "lucide-react";

interface Stats {
  tickets: number;
  qa_pairs: number;
  categories: number;
  last_sync_at: number | null;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

const cards = [
  {
    key: "tickets" as const,
    label: "Tickets",
    icon: Ticket,
    color: "bg-violet-50 text-violet-600",
    ring: "ring-violet-100",
  },
  {
    key: "qa_pairs" as const,
    label: "Q&A Pairs",
    icon: MessageSquare,
    color: "bg-blue-50 text-blue-600",
    ring: "ring-blue-100",
  },
  {
    key: "categories" as const,
    label: "Categories",
    icon: Tag,
    color: "bg-emerald-50 text-emerald-600",
    ring: "ring-emerald-100",
  },
];

export function StatsGrid({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ key, label, icon: Icon, color, ring }) => (
        <div
          key={key}
          className={`bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm`}
        >
          <div className={`p-2.5 rounded-lg ring-1 ${color} ${ring}`}>
            <Icon size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">
              {stats[key].toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
        </div>
      ))}

      {/* Last sync card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
        <div className="p-2.5 rounded-lg ring-1 bg-amber-50 text-amber-600 ring-amber-100">
          <Clock size={20} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {timeAgo(stats.last_sync_at)}
          </p>
          <p className="text-sm text-slate-500">Last sync</p>
        </div>
      </div>
    </div>
  );
}
