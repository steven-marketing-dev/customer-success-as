"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Video } from "lucide-react";
import ProcessCardItem, { type ProcessCardData } from "./ProcessCardItem";

export default function VideoGuidesPanel() {
  const [cards, setCards] = useState<ProcessCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchCards = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "50");
      const res = await fetch(`/api/process-cards?${params}`);
      const data = await res.json();
      setCards(data.cards ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards(query);
  }, [fetchCards, query]);

  // Debounced search
  const [inputVal, setInputVal] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(inputVal), 300);
    return () => clearTimeout(t);
  }, [inputVal]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search video guides..."
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className="input-warm pl-9 text-sm"
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Video size={12} />
        <span>{total} process card{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]">Loading...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-12">
          <Video size={32} className="mx-auto mb-3 text-[var(--text-muted)] opacity-40" />
          <p className="text-sm text-[var(--text-muted)]">
            {query ? "No video guides match your search" : "No video guides yet. Run \"Extract Videos\" from the Pipeline tab."}
          </p>
        </div>
      ) : (
        <div data-tour="video-cards-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => (
            <ProcessCardItem key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
