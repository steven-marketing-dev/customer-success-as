"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  X,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";

export interface TermItem {
  id: number;
  name: string;
  definition: string;
  aliases: string; // JSON array
  qa_count: number;
  article_count: number;
  created_at: number;
  updated_at: number;
}

interface Props {
  term: TermItem;
  onUpdate?: (updated: TermItem) => void;
  onDelete?: (id: number) => void;
}

export function TermCard({ term, onUpdate, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkedQAs, setLinkedQAs] = useState<Array<{ id: number; question: string }> | null>(null);
  const [linkedArticles, setLinkedArticles] = useState<Array<{ id: number; title: string; url: string }> | null>(null);

  // Edit state
  const [editName, setEditName] = useState(term.name);
  const [editDefinition, setEditDefinition] = useState(term.definition);
  const [editAliases, setEditAliases] = useState<string[]>(
    JSON.parse(term.aliases || "[]")
  );
  const [newAlias, setNewAlias] = useState("");

  const aliases: string[] = JSON.parse(term.aliases || "[]");

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !linkedQAs) {
      try {
        const res = await fetch(`/api/terms/${term.id}`);
        const data = await res.json();
        setLinkedQAs(
          (data.qa_pairs ?? []).map((q: { id: number; question: string }) => ({
            id: q.id,
            question: q.question,
          }))
        );
        setLinkedArticles(
          (data.articles ?? []).map((a: { id: number; title: string; url: string }) => ({
            id: a.id,
            title: a.title,
            url: a.url,
          }))
        );
      } catch {
        setLinkedQAs([]);
        setLinkedArticles([]);
      }
    }
  };

  const startEdit = () => {
    setEditName(term.name);
    setEditDefinition(term.definition);
    setEditAliases(JSON.parse(term.aliases || "[]"));
    setNewAlias("");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/terms/${term.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          definition: editDefinition,
          aliases: editAliases,
        }),
      });
      const updated = await res.json();
      onUpdate?.(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete term "${term.name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/terms/${term.id}`, { method: "DELETE" });
      onDelete?.(term.id);
    } finally {
      setDeleting(false);
    }
  };

  const addAlias = () => {
    const v = newAlias.trim();
    if (v && !editAliases.includes(v)) {
      setEditAliases([...editAliases, v]);
      setNewAlias("");
    }
  };

  if (editing) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Term name"
        />
        <textarea
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={editDefinition}
          onChange={(e) => setEditDefinition(e.target.value)}
          rows={3}
          placeholder="Definition"
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-500">Aliases</p>
          <div className="flex flex-wrap gap-1">
            {editAliases.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
              >
                {a}
                <button
                  onClick={() => setEditAliases(editAliases.filter((_, j) => j !== i))}
                  className="text-zinc-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAlias())}
              placeholder="Add alias..."
            />
            <button onClick={addAlias} className="rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex items-center gap-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900 text-sm">{term.name}</h3>
            {onUpdate && (
              <button
                onClick={startEdit}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-blue-600 transition-opacity"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-600 leading-relaxed">{term.definition}</p>
          {aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {aliases.map((a, i) => (
                <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {term.qa_count > 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
              {term.qa_count} Q&A
            </span>
          )}
          {term.article_count > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
              {term.article_count} Articles
            </span>
          )}
        </div>
      </div>

      {(term.qa_count > 0 || term.article_count > 0) && (
        <button
          onClick={handleExpand}
          className="flex items-center justify-center gap-1 border-t border-zinc-100 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
        >
          {expanded ? (
            <>Hide references <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>View references <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}

      {expanded && (linkedQAs || linkedArticles) && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 space-y-3">
          {linkedQAs && linkedQAs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-1.5">Q&A Cards</p>
              <ul className="space-y-1.5">
                {linkedQAs.map((qa) => (
                  <li key={qa.id} className="text-xs text-zinc-600 leading-snug">
                    <span className="text-zinc-400 mr-1">#{qa.id}</span>
                    {qa.question}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {linkedArticles && linkedArticles.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-1.5">Articles</p>
              <ul className="space-y-1.5">
                {linkedArticles.map((a) => (
                  <li key={a.id} className="text-xs text-zinc-600 leading-snug">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!linkedQAs || linkedQAs.length === 0) && (!linkedArticles || linkedArticles.length === 0) && (
            <p className="text-xs text-zinc-400">No references found.</p>
          )}
        </div>
      )}
    </div>
  );
}
