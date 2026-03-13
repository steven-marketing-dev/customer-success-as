"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, X, Loader2, Sparkles } from "lucide-react";
import { BehavioralCardItem, type BehavioralCardData } from "./BehavioralCardItem";

type ScopeFilter = "all" | "global" | "category";
type TypeFilter = "all" | "knowledge" | "solution" | "general";

export function BehavioralCardsPanel() {
  const [cards, setCards] = useState<BehavioralCardData[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [newType, setNewType] = useState<"knowledge" | "solution" | "general">("general");
  const [newScope, setNewScope] = useState<"global" | "category">("global");
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleAIComplete = async () => {
    if (!newTitle.trim()) return;
    setGenerating(true);
    try {
      const categoryName = newScope === "category" && newCategoryId
        ? categories.find((c) => c.id === newCategoryId)?.name
        : undefined;
      const res = await fetch("/api/behavioral-cards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          type: newType,
          scope: newScope,
          category_name: categoryName,
          partial_instruction: newInstruction.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.instruction) setNewInstruction(data.instruction);
      }
    } finally {
      setGenerating(false);
    }
  };

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/behavioral-cards");
      const data = await res.json();
      setCards(Array.isArray(data) ? data : []);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/kb");
      const data = await res.json();
      if (Array.isArray(data.categories)) {
        setCategories(data.categories.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchCards();
    fetchCategories();
  }, [fetchCards, fetchCategories]);

  const filtered = cards.filter((c) => {
    if (scopeFilter !== "all" && c.scope !== scopeFilter) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return c.title.toLowerCase().includes(q) || c.instruction.toLowerCase().includes(q);
    }
    return true;
  });

  const handleCreate = async () => {
    if (!newTitle.trim() || !newInstruction.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/behavioral-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          instruction: newInstruction.trim(),
          type: newType,
          scope: newScope,
          category_id: newScope === "category" ? newCategoryId : null,
        }),
      });
      if (res.ok) {
        const card = await res.json();
        const catName = newScope === "category" ? categories.find((c) => c.id === newCategoryId)?.name : undefined;
        setCards((prev) => [{ ...card, category_name: catName }, ...prev]);
        setNewTitle("");
        setNewInstruction("");
        setNewType("general");
        setNewScope("global");
        setNewCategoryId(null);
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = (updated: BehavioralCardData) => {
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDelete = (id: number) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const scopeOptions: { value: ScopeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "global", label: "Global" },
    { value: "category", label: "Category" },
  ];

  const typeOptions: { value: TypeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "knowledge", label: "Knowledge" },
    { value: "solution", label: "Solution" },
    { value: "general", label: "General" },
  ];

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search rules..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Rule
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400 font-medium">Scope:</span>
          {scopeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setScopeFilter(opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                scopeFilter === opt.value
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400 font-medium">Type:</span>
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === opt.value
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Rule title (e.g., Concise password reset answers)"
          />
          <div className="relative">
            <textarea
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={newInstruction}
              onChange={(e) => setNewInstruction(e.target.value)}
              rows={3}
              placeholder="Instruction for the agent (e.g., For password reset questions, provide step-by-step instructions only, no background explanation)"
            />
            <button
              type="button"
              onClick={handleAIComplete}
              disabled={generating || !newTitle.trim()}
              className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              AI Complete
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Type:</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "knowledge" | "solution" | "general")}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="general">General</option>
                <option value="knowledge">Knowledge</option>
                <option value="solution">Solution</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Scope:</label>
              <select
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as "global" | "category")}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="global">Global</option>
                <option value="category">Category</option>
              </select>
            </div>
            {newScope === "category" && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Category:</label>
                <select
                  value={newCategoryId ?? ""}
                  onChange={(e) => setNewCategoryId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim() || !newInstruction.trim()}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Cards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          {cards.length === 0
            ? "No behavioral rules yet. Add your first rule to teach the agent how to respond!"
            : "No rules match your filters."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((card) => (
            <BehavioralCardItem
              key={card.id}
              card={card}
              categories={categories}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
