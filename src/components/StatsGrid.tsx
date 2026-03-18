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
    iconBg: "bg-mint-50",
    iconColor: "text-mint-500",
  },
  {
    key: "qa_pairs" as const,
    label: "Q&A Pairs",
    icon: MessageSquare,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-500",
  },
  {
    key: "categories" as const,
    label: "Categories",
    icon: Tag,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-500",
  },
];

export function StatsGrid({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ key, label, icon: Icon, iconBg, iconColor }) => (
        <div
          key={key}
          className="card-warm p-5 flex items-center gap-4 fade-up"
        >
          <div className={`p-2.5 rounded-xl ${iconBg} ${iconColor}`}>
            <Icon size={20} />
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-warm-800">
              {stats[key].toLocaleString()}
            </p>
            <p className="text-sm text-warm-500">{label}</p>
          </div>
        </div>
      ))}

      {/* Last sync card */}
      <div className="card-warm p-5 flex items-center gap-4 fade-up">
        <div className="p-2.5 rounded-xl bg-amber-50 text-amber-500">
          <Clock size={20} />
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-warm-800">
            {timeAgo(stats.last_sync_at)}
          </p>
          <p className="text-sm text-warm-500">Last sync</p>
        </div>
      </div>
    </div>
  );
}
