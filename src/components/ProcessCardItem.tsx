"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, FileText, Tag } from "lucide-react";

export interface ProcessCardData {
  id: number;
  loom_video_id: string;
  loom_url: string;
  title: string;
  summary: string;
  steps: string; // JSON array
  source_type: string;
  source_id: number;
  created_at: number;
}

interface Props {
  card: ProcessCardData;
}

export default function ProcessCardItem({ card }: Props) {
  const [expanded, setExpanded] = useState(false);

  let steps: string[] = [];
  try {
    steps = JSON.parse(card.steps);
  } catch {
    /* invalid JSON */
  }

  const visibleSteps = expanded ? steps : steps.slice(0, 3);
  const hasMore = steps.length > 3;

  const sourceLabel =
    card.source_type === "qa"
      ? `QA #${card.source_id}`
      : card.source_type === "article"
        ? `Article #${card.source_id}`
        : `Ref Doc #${card.source_id}`;

  return (
    <div className="card-warm p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display font-700 text-[15px] text-[var(--text)] leading-snug" title={card.title}>
          {card.title}
        </h3>
        <a
          href={card.loom_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-[var(--mint-light)] text-[var(--text-muted)] hover:text-[var(--mint)] transition-colors"
          title="Watch video"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Summary */}
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{card.summary}</p>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Steps ({steps.length})
          </p>
          <ol className="space-y-1.5 pl-1">
            {visibleSteps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--mint-light)] text-[var(--mint-dark)] text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-[var(--text-secondary)]">{step}</span>
              </li>
            ))}
          </ol>
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs font-medium text-[var(--mint)] hover:text-[var(--mint-dark)] transition-colors mt-1"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "Show less" : `Show all ${steps.length} steps`}
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 border-t border-[var(--border)]">
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <FileText size={11} />
          {sourceLabel}
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Tag size={11} />
          {new Date(card.created_at * 1000).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
