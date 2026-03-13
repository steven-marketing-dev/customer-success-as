"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, X, Loader2 } from "lucide-react";
import { TermCard, type TermItem } from "./TermCard";

export function TermsPanel() {
  const [terms, setTerms] = useState<TermItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDefinition, setNewDefinition] = useState("");
  const [newAliases, setNewAliases] = useState("");

  const fetchTerms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/terms");
      const data = await res.json();
      setTerms(Array.isArray(data) ? data : []);
    } catch {
      setTerms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerms();
  }, [fetchTerms]);

  const filtered = query.trim()
    ? terms.filter((t) => {
        const q = query.toLowerCase();
        const aliases: string[] = JSON.parse(t.aliases || "[]");
        return (
          t.name.toLowerCase().includes(q) ||
          t.definition.toLowerCase().includes(q) ||
          aliases.some((a) => a.toLowerCase().includes(q))
        );
      })
    : terms;

  const handleCreate = async () => {
    if (!newName.trim() || !newDefinition.trim()) return;
    setCreating(true);
    try {
      const aliases = newAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const res = await fetch("/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), definition: newDefinition.trim(), aliases }),
      });
      if (res.ok) {
        const term = await res.json();
        setTerms((prev) => [...prev, term].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName("");
        setNewDefinition("");
        setNewAliases("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = (updated: TermItem) => {
    setTerms((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDelete = (id: number) => {
    setTerms((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search terms..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Term
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Term name (e.g., Assessment)"
          />
          <textarea
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newDefinition}
            onChange={(e) => setNewDefinition(e.target.value)}
            rows={2}
            placeholder="Definition..."
          />
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newAliases}
            onChange={(e) => setNewAliases(e.target.value)}
            placeholder="Aliases (comma-separated, e.g., test, evaluation)"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim() || !newDefinition.trim()}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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

      {/* Terms grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          {terms.length === 0 ? "No terms yet. Add your first glossary term!" : "No terms match your search."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((term) => (
            <TermCard
              key={term.id}
              term={term}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
