"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

export interface ArticleItem {
  id: number;
  url: string;
  title: string;
  content: string;
  category: string | null;
  scraped_at: number;
}

interface Props {
  article: ArticleItem;
}

const CATEGORY_COLORS: Record<string, string> = {};
const PALETTE = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-mint-100 text-mint-700",
];
let colorIdx = 0;

function getCategoryColor(cat: string): string {
  if (!CATEGORY_COLORS[cat]) {
    CATEGORY_COLORS[cat] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return CATEGORY_COLORS[cat];
}

export function ArticleCard({ article }: Props) {
  const [expanded, setExpanded] = useState(false);

  const preview = article.content.length > 200
    ? article.content.slice(0, 200) + "..."
    : article.content;

  const scrapedDate = new Date(article.scraped_at * 1000).toLocaleDateString();

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-zinc-900 text-sm leading-snug line-clamp-2" title={article.title}>{article.title}</h3>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-zinc-400 hover:text-blue-600 transition-colors"
            title="Open original article"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {article.category && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getCategoryColor(article.category)}`}>
              {article.category}
            </span>
          )}
          <span className="text-xs text-zinc-400">Scraped {scrapedDate}</span>
        </div>
        <p className="mt-2 text-xs text-zinc-500 leading-relaxed line-clamp-3">{preview}</p>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center gap-1 border-t border-zinc-100 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
      >
        {expanded ? (
          <>Collapse <ChevronUp className="h-3 w-3" /></>
        ) : (
          <>Read more <ChevronDown className="h-3 w-3" /></>
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 max-h-96 overflow-y-auto">
          <p className="text-xs text-zinc-600 leading-relaxed whitespace-pre-line">
            {article.content}
          </p>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Open original <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
