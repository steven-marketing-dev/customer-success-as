"use client";

import { useState } from "react";
import {
  Pencil,
  Save,
  X,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

export interface BehavioralCardData {
  id: number;
  title: string;
  instruction: string;
  type: "knowledge" | "solution" | "general";
  scope: "global" | "category";
  category_id: number | null;
  category_name?: string;
  active: number;
  source: string;
  created_at: number;
  updated_at: number;
}

interface Props {
  card: BehavioralCardData;
  categories: Array<{ id: number; name: string }>;
  onUpdate?: (updated: BehavioralCardData) => void;
  onDelete?: (id: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  knowledge: "bg-blue-100 text-blue-700",
  solution: "bg-emerald-100 text-emerald-700",
  general: "bg-slate-100 text-slate-600",
};

const SCOPE_COLORS: Record<string, string> = {
  global: "bg-indigo-100 text-indigo-700",
  category: "bg-orange-100 text-orange-700",
};

export function BehavioralCardItem({ card, categories, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [title, setTitle] = useState(card.title);
  const [instruction, setInstruction] = useState(card.instruction);
  const [type, setType] = useState(card.type);
  const [scope, setScope] = useState(card.scope);
  const [categoryId, setCategoryId] = useState<number | null>(card.category_id);

  const handleSave = async () => {
    if (!title.trim() || !instruction.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/behavioral-cards/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          instruction: instruction.trim(),
          type,
          scope,
          category_id: scope === "category" ? categoryId : null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        const catName = scope === "category" ? categories.find((c) => c.id === categoryId)?.name : undefined;
        onUpdate?.({ ...updated, category_name: catName });
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    const newActive = card.active ? 0 : 1;
    const res = await fetch(`/api/behavioral-cards/${card.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: newActive }),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate?.({ ...updated, category_name: card.category_name });
    }
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/behavioral-cards/${card.id}`, { method: "DELETE" });
    if (res.ok) onDelete?.(card.id);
  };

  const cancelEdit = () => {
    setEditing(false);
    setTitle(card.title);
    setInstruction(card.instruction);
    setType(card.type);
    setScope(card.scope);
    setCategoryId(card.category_id);
  };

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${!card.active ? "opacity-50" : ""}`}>
      {editing ? (
        <div className="space-y-3">
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Rule title"
          />
          <textarea
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="Instruction for the agent..."
          />
          <div className="flex gap-3">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "knowledge" | "solution" | "general")}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="general">General</option>
              <option value="knowledge">Knowledge</option>
              <option value="solution">Solution</option>
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "global" | "category")}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="global">Global</option>
              <option value="category">Category</option>
            </select>
            {scope === "category" && (
              <select
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !instruction.trim()}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button onClick={cancelEdit} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 hover:bg-zinc-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 leading-snug">{card.title}</h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{card.instruction}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={handleToggleActive}
                title={card.active ? "Disable rule" : "Enable rule"}
                className="p-1 rounded hover:bg-zinc-100 transition-colors"
              >
                {card.active ? (
                  <ToggleRight className="h-4 w-4 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-4 w-4 text-zinc-400" />
                )}
              </button>
              <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-zinc-100 transition-colors">
                <Pencil className="h-3.5 w-3.5 text-zinc-400" />
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDelete}
                    className="px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-700"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="p-1 rounded hover:bg-zinc-100"
                  >
                    <X className="h-3 w-3 text-zinc-400" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="p-1 rounded hover:bg-zinc-100 transition-colors">
                  <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${TYPE_COLORS[card.type]}`}>
              {card.type}
            </span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${SCOPE_COLORS[card.scope]}`}>
              {card.scope === "category" && card.category_name
                ? card.category_name
                : card.scope}
            </span>
            {card.source === "suggested" && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                auto-suggested
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
