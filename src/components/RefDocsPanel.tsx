"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Plus,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  Trash2,
  RefreshCw,
  FileText,
  Link,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface RefDocData {
  id: number;
  title: string;
  source_type: "google_doc" | "manual";
  source_url: string | null;
  active: number;
  section_count: number;
  created_at: number;
  updated_at: number;
}

interface RefDocSectionData {
  id: number;
  doc_id: number;
  heading: string;
  content: string;
  section_order: number;
  created_at: number;
}

export function RefDocsPanel() {
  const [docs, setDocs] = useState<RefDocData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  // Create form
  const [newTitle, setNewTitle] = useState("");
  const [newSourceType, setNewSourceType] = useState<"google_doc" | "manual">("google_doc");
  const [newSourceUrl, setNewSourceUrl] = useState("");

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ref-docs");
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const filtered = docs.filter((d) => {
    if (!query.trim()) return true;
    return d.title.toLowerCase().includes(query.toLowerCase());
  });

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    if (newSourceType === "google_doc" && !newSourceUrl.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/ref-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          source_type: newSourceType,
          source_url: newSourceType === "google_doc" ? newSourceUrl.trim() : null,
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setNewSourceUrl("");
        setNewSourceType("google_doc");
        setShowCreate(false);
        fetchDocs();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (doc: RefDocData) => {
    const res = await fetch(`/api/ref-docs/${doc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: doc.active ? 0 : 1 }),
    });
    if (res.ok) {
      setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, active: doc.active ? 0 : 1 } : d));
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/ref-docs/${id}`, { method: "DELETE" });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Document
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <input
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Document title"
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500">Source:</label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="source_type"
                value="google_doc"
                checked={newSourceType === "google_doc"}
                onChange={() => setNewSourceType("google_doc")}
                className="accent-indigo-600"
              />
              <span className="text-xs text-zinc-700">Google Doc</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="source_type"
                value="manual"
                checked={newSourceType === "manual"}
                onChange={() => setNewSourceType("manual")}
                className="accent-indigo-600"
              />
              <span className="text-xs text-zinc-700">Manual</span>
            </label>
          </div>
          {newSourceType === "google_doc" && (
            <input
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              placeholder="Google Doc URL (must be shared with 'Anyone with the link')"
            />
          )}
          {newSourceType === "manual" && (
            <p className="text-xs text-zinc-500">You can add sections manually after creating the document.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim() || (newSourceType === "google_doc" && !newSourceUrl.trim())}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {newSourceType === "google_doc" ? "Import" : "Create"}
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

      {/* Documents list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          {docs.length === 0
            ? "No reference documents yet. Add a Google Doc or create a manual document."
            : "No documents match your search."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((doc) => (
            <RefDocCard
              key={doc.id}
              doc={doc}
              onToggleActive={() => handleToggleActive(doc)}
              onDelete={() => handleDelete(doc.id)}
              onRefresh={fetchDocs}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual Document Card ────────────────────────────────────────────────

function RefDocCard({
  doc,
  onToggleActive,
  onDelete,
  onRefresh,
}: {
  doc: RefDocData;
  onToggleActive: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sections, setSections] = useState<RefDocSectionData[]>([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);

  const fetchSections = useCallback(async () => {
    setLoadingSections(true);
    try {
      const res = await fetch(`/api/ref-docs/${doc.id}`);
      const data = await res.json();
      setSections(Array.isArray(data.sections) ? data.sections : []);
    } catch {
      setSections([]);
    } finally {
      setLoadingSections(false);
    }
  }, [doc.id]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && sections.length === 0) fetchSections();
  };

  const handleReimport = async () => {
    setReimporting(true);
    try {
      const res = await fetch(`/api/ref-docs/${doc.id}/sections`, { method: "PUT" });
      if (res.ok) {
        await fetchSections();
        onRefresh();
      }
    } finally {
      setReimporting(false);
    }
  };

  const handleDeleteSection = async (sectionId: number) => {
    const res = await fetch(`/api/ref-docs/${doc.id}/sections/${sectionId}`, { method: "DELETE" });
    if (res.ok) {
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
      onRefresh();
    }
  };

  return (
    <div className={`rounded-xl border bg-white shadow-sm transition-all ${!doc.active ? "opacity-50" : ""}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {doc.source_type === "google_doc" ? (
                <Link className="h-4 w-4 text-blue-500 flex-shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-zinc-400 flex-shrink-0" />
              )}
              <h3 className="text-sm font-semibold text-slate-800 leading-snug truncate" title={doc.title}>
                {doc.title}
              </h3>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                doc.source_type === "google_doc" ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"
              }`}>
                {doc.source_type === "google_doc" ? "Google Doc" : "Manual"}
              </span>
              <span className="text-[10px] text-zinc-400">{doc.section_count} sections</span>
              <span className="text-[10px] text-zinc-400">
                {new Date(doc.created_at * 1000).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onToggleActive} title={doc.active ? "Disable" : "Enable"} className="p-1 rounded hover:bg-zinc-100 transition-colors">
              {doc.active ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4 text-zinc-400" />}
            </button>
            {doc.source_type === "google_doc" && (
              <button
                onClick={handleReimport}
                disabled={reimporting}
                title="Re-import from Google Doc"
                className="p-1 rounded hover:bg-zinc-100 transition-colors"
              >
                {reimporting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />}
              </button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={onDelete} className="px-2 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-700">Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="p-1 rounded hover:bg-zinc-100">
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
      </div>

      {/* Expand/collapse sections */}
      <button
        onClick={handleExpand}
        className="flex items-center justify-center gap-1 border-t border-zinc-100 w-full py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
      >
        {expanded ? (
          <>Hide sections <ChevronUp className="h-3 w-3" /></>
        ) : (
          <>Show sections ({doc.section_count}) <ChevronDown className="h-3 w-3" /></>
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 p-3 space-y-2">
          {loadingSections ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            </div>
          ) : sections.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-2">No sections yet.</p>
          ) : (
            sections.map((section) => (
              <SectionItem
                key={section.id}
                section={section}
                docId={doc.id}
                onDelete={() => handleDeleteSection(section.id)}
                onUpdate={(updated) => setSections((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
              />
            ))
          )}
          {/* Add section button */}
          {showAddSection ? (
            <AddSectionForm
              docId={doc.id}
              onCreated={(section) => {
                setSections((prev) => [...prev, section]);
                setShowAddSection(false);
                onRefresh();
              }}
              onCancel={() => setShowAddSection(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddSection(true)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Plus className="h-3 w-3" /> Add Section
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section Item ────────────────────────────────────────────────────────────

function SectionItem({
  section,
  docId,
  onDelete,
  onUpdate,
}: {
  section: RefDocSectionData;
  docId: number;
  onDelete: () => void;
  onUpdate: (updated: RefDocSectionData) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heading, setHeading] = useState(section.heading);
  const [content, setContent] = useState(section.content);

  const preview = section.content.length > 150 ? section.content.slice(0, 150) + "..." : section.content;

  const handleSave = async () => {
    if (!heading.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ref-docs/${docId}/sections/${section.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heading: heading.trim(), content: content.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2">
        <input
          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          placeholder="Section heading"
        />
        <textarea
          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !heading.trim() || !content.trim()}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setHeading(section.heading); setContent(section.content); }}
            className="rounded bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setExpanded(!expanded)} className="flex-1 text-left min-w-0">
          <h4 className="text-xs font-semibold text-slate-700 truncate" title={section.heading}>{section.heading}</h4>
          {!expanded && <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{preview}</p>}
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-zinc-100">
            <Pencil className="h-3 w-3 text-zinc-400" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-zinc-100">
            <Trash2 className="h-3 w-3 text-zinc-400" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 max-h-60 overflow-y-auto">
          <p className="text-[11px] text-zinc-600 leading-relaxed whitespace-pre-line">{section.content}</p>
        </div>
      )}
    </div>
  );
}

// ─── Add Section Form ────────────────────────────────────────────────────────

function AddSectionForm({
  docId,
  onCreated,
  onCancel,
}: {
  docId: number;
  onCreated: (section: RefDocSectionData) => void;
  onCancel: () => void;
}) {
  const [heading, setHeading] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!heading.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ref-docs/${docId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heading: heading.trim(), content: content.trim() }),
      });
      if (res.ok) {
        const section = await res.json();
        onCreated(section);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2">
      <input
        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
        value={heading}
        onChange={(e) => setHeading(e.target.value)}
        placeholder="Section heading (e.g., 'Assertiveness Trait Definition')"
      />
      <textarea
        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        placeholder="Section content (paste text here)"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={saving || !heading.trim() || !content.trim()}
          className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
        <button onClick={onCancel} className="rounded bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 border border-zinc-200 hover:bg-zinc-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
