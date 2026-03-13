"use client";

import { useState, useCallback, useEffect } from "react";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { QACard, type QAItem } from "./QACard";
import { type CategorySummary } from "./CategoryGrid";

interface Props {
  initialResults?: QAItem[];
  categories?: CategorySummary[];
  selectedCategory?: number | null;
  onCategoryChange?: (id: number | null) => void;
}

const PAGE_SIZE = 30;

export function SearchPanel({
  initialResults = [],
  categories = [],
  selectedCategory = null,
  onCategoryChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QAItem[]>(initialResults);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const search = useCallback(async (q: string, catId: number | null, offset = 0) => {
    const isLoadMore = offset > 0;
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (catId) params.set("category", String(catId));
      params.set("limit", String(PAGE_SIZE + 1));
      if (offset > 0) params.set("offset", String(offset));

      const res = await fetch(`/api/search?${params}`);
      const data = await res.json() as { results: QAItem[] };
      const fetched = data.results ?? [];
      const more = fetched.length > PAGE_SIZE;
      const page = more ? fetched.slice(0, PAGE_SIZE) : fetched;
      setHasMore(more);

      if (isLoadMore) {
        setResults((prev) => [...prev, ...page]);
      } else {
        setResults(page);
      }
    } catch {
      if (!isLoadMore) setResults([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      search(query, selectedCategory);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selectedCategory, search]);

  const PALETTE = [
    "bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200",
    "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200",
    "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200",
    "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200",
    "bg-pink-100 text-pink-700 border-pink-200 hover:bg-pink-200",
    "bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-200",
  ];

  const selectedCatName = selectedCategory
    ? categories.find((c) => c.id === selectedCategory)?.name
    : null;

  return (
    <div className="space-y-5">
      {/* Search input */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the knowledge base..."
          className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm transition"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Active filter + toggle */}
      <div className="flex items-center gap-2">
        {selectedCatName && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-600 text-white">
            {selectedCatName}
            <button onClick={() => onCategoryChange?.(null)} className="hover:bg-indigo-500 rounded-full p-0.5">
              <X size={12} />
            </button>
          </span>
        )}
        {categories.length > 0 && (
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-500 border border-slate-200 hover:border-slate-300 transition-all"
          >
            {showFilters ? "Hide filters" : "Filters"}
            {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* Category filter pills (collapsible) */}
      {showFilters && categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onCategoryChange?.(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              selectedCategory === null
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            All
          </button>
          {categories.map((cat, i) => (
            <button
              key={cat.id}
              onClick={() => onCategoryChange?.(selectedCategory === cat.id ? null : cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                selectedCategory === cat.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : `${PALETTE[i % PALETTE.length]} border-transparent`
              }`}
            >
              {cat.name} <span className="opacity-60">({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Search size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {query || selectedCategory
                ? "No results found."
                : "Run the pipeline to populate the knowledge base."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((qa) => (
              <QACard
                key={qa.id}
                qa={qa}
                onUpdate={(updated) =>
                  setResults((prev) =>
                    prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
                  )
                }
              />
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className="text-center mt-4 space-y-2">
            {hasMore && (
              <button
                onClick={() => search(query, selectedCategory, results.length)}
                disabled={loadingMore}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
            <p className="text-xs text-slate-400">
              {results.length} result{results.length !== 1 ? "s" : ""}{hasMore ? "+" : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
