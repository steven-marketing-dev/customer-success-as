"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Copy, Check, Trash2, Pencil, X, ExternalLink, Star } from "lucide-react";

interface Installation {
  id: number;
  key: string;
  name: string;
  allowed_origins: string;
  calendly_url: string | null;
  product_name: string | null;
  primary_color: string | null;
  rate_limit_per_hour: number;
  enable_chat: number;
  enable_email: number;
  enable_calendly: number;
  is_active: number;
  created_at: number;
  updated_at: number;
  rating_count: number;
  avg_rating: number | null;
}

interface EditForm {
  name: string;
  allowed_origins: string;
  calendly_url: string;
  product_name: string;
  primary_color: string;
  rate_limit_per_hour: number;
  enable_chat: boolean;
  enable_email: boolean;
  enable_calendly: boolean;
  is_active: boolean;
}

const emptyForm: EditForm = {
  name: "",
  allowed_origins: "",
  calendly_url: "",
  product_name: "",
  primary_color: "#0d9488",
  rate_limit_per_hour: 60,
  enable_chat: true,
  enable_email: true,
  enable_calendly: true,
  is_active: true,
};

function parseOrigins(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function WidgetInstallationsPanel() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Installation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<EditForm>(emptyForm);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/widget-installations");
      if (res.ok) setInstallations(await res.json());
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => {
    setForm(emptyForm);
    setEditing(null);
    setCreating(true);
    setError(null);
  };

  const startEdit = (i: Installation) => {
    setForm({
      name: i.name,
      allowed_origins: parseOrigins(i.allowed_origins).join("\n"),
      calendly_url: i.calendly_url ?? "",
      product_name: i.product_name ?? "",
      primary_color: i.primary_color ?? "#0d9488",
      rate_limit_per_hour: i.rate_limit_per_hour,
      enable_chat: !!i.enable_chat,
      enable_email: !!i.enable_email,
      enable_calendly: !!i.enable_calendly,
      is_active: !!i.is_active,
    });
    setEditing(i);
    setCreating(false);
    setError(null);
  };

  const cancelEdit = () => { setEditing(null); setCreating(false); setError(null); };

  const save = async () => {
    setError(null);
    const payload = {
      name: form.name.trim(),
      allowed_origins: form.allowed_origins.split("\n").map((s) => s.trim()).filter(Boolean),
      calendly_url: form.calendly_url.trim() || null,
      product_name: form.product_name.trim() || null,
      primary_color: form.primary_color.trim() || null,
      rate_limit_per_hour: Number(form.rate_limit_per_hour) || 60,
      enable_chat: form.enable_chat,
      enable_email: form.enable_email,
      enable_calendly: form.enable_calendly,
      is_active: form.is_active,
    };
    if (!payload.name) { setError("Name is required"); return; }

    try {
      const res = editing
        ? await fetch(`/api/widget-installations/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/widget-installations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) { setError((await res.json()).error ?? "Save failed"); return; }
      cancelEdit();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this widget installation? This will stop it from loading on the host page and remove its ratings.")) return;
    await fetch(`/api/widget-installations/${id}`, { method: "DELETE" });
    load();
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const copySnippet = (i: Installation) => {
    const host = typeof window !== "undefined" ? window.location.origin : "https://YOUR-HOST";
    const snippet = `<script src="${host}/widget.js" data-key="${i.key}" defer></script>`;
    navigator.clipboard.writeText(snippet);
    setCopiedKey(`snippet-${i.id}`);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const showForm = creating || editing;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0C1222] tracking-tight mb-1">Widget Installations</h1>
          <p className="text-sm text-slate-500">Embed the agent chat into your client products. Each installation has its own key, origin allowlist, and usage stats.</p>
        </div>
        {!showForm && (
          <button onClick={startCreate} className="flex items-center gap-1.5 rounded-lg bg-mint-600 px-3 py-2 text-sm font-medium text-white hover:bg-mint-700">
            <Plus size={14} />New installation
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              {editing ? `Edit: ${editing.name}` : "Create new installation"}
            </h2>
            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Name (internal)</span>
              <input
                type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Discovered Production"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Product name (shown to users)</span>
              <input
                type="text" value={form.product_name} onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                placeholder="Discovered Help"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
              />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Allowed origins (one per line)</span>
              <textarea
                value={form.allowed_origins} onChange={(e) => setForm((f) => ({ ...f, allowed_origins: e.target.value }))}
                rows={3}
                placeholder={"https://app.discovered.ai\nhttps://staging.discovered.ai"}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
              />
              <span className="text-[11px] text-slate-400">Exact match including protocol + port. Use <code className="bg-slate-100 px-1 py-0.5 rounded">*</code> for dev-only wildcard (not recommended).</span>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Calendly URL (optional)</span>
              <input
                type="text" value={form.calendly_url} onChange={(e) => setForm((f) => ({ ...f, calendly_url: e.target.value }))}
                placeholder="https://calendly.com/your-team/support"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Primary color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color" value={form.primary_color} onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="h-9 w-12 rounded border border-slate-200 cursor-pointer bg-white"
                />
                <input
                  type="text" value={form.primary_color} onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  placeholder="#0d9488"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                />
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Rate limit (req/hour per IP)</span>
              <input
                type="number" min={1} value={form.rate_limit_per_hour} onChange={(e) => setForm((f) => ({ ...f, rate_limit_per_hour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent"
              />
            </label>

            <div className="sm:col-span-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-medium text-slate-600">Menu options shown to end users</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.enable_chat} onChange={(e) => setForm((f) => ({ ...f, enable_chat: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-slate-700">Chat Support</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.enable_email} onChange={(e) => setForm((f) => ({ ...f, enable_email: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-slate-700">Email Support</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.enable_calendly} onChange={(e) => setForm((f) => ({ ...f, enable_calendly: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-slate-700">Schedule a Meeting <span className="text-xs text-slate-400">(requires Calendly URL)</span></span>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
              <span className="text-sm text-slate-700">Active (uncheck to disable this key)</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} className="rounded-lg bg-mint-600 px-4 py-2 text-sm font-medium text-white hover:bg-mint-700">
              {editing ? "Save changes" : "Create"}
            </button>
            <button onClick={cancelEdit} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : installations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          No widget installations yet. Click <strong>New installation</strong> to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {installations.map((i) => {
            const origins = parseOrigins(i.allowed_origins);
            return (
              <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-800">{i.name}</h3>
                      {!i.is_active && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-red-100 text-red-700 font-medium">disabled</span>}
                      {i.product_name && <span className="text-xs text-slate-400">({i.product_name})</span>}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <code className="text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-700 font-mono">{i.key}</code>
                      <button onClick={() => copyKey(i.key)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
                        {copiedKey === i.key ? <><Check size={11} className="text-emerald-500" />Copied</> : <><Copy size={11} />Copy key</>}
                      </button>
                      <button onClick={() => copySnippet(i)} className="inline-flex items-center gap-1 text-[11px] text-mint-600 hover:text-mint-800">
                        {copiedKey === `snippet-${i.id}` ? <><Check size={11} className="text-emerald-500" />Copied</> : <><Copy size={11} />Copy &lt;script&gt; snippet</>}
                      </button>
                    </div>

                    {origins.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {origins.map((o) => (
                          <span key={o} className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">{o}</span>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1">
                      {i.enable_chat ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-mint-50 text-mint-700 border border-mint-200">Chat</span> : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-200 line-through">Chat</span>}
                      {i.enable_email ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-mint-50 text-mint-700 border border-mint-200">Email</span> : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-200 line-through">Email</span>}
                      {i.enable_calendly && i.calendly_url ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-mint-50 text-mint-700 border border-mint-200">Calendly</span> : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-200 line-through">Calendly</span>}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>Rate limit: <strong>{i.rate_limit_per_hour}/h/IP</strong></span>
                      <span className="inline-flex items-center gap-1">
                        <Star size={11} className={i.avg_rating && i.avg_rating >= 2.5 ? "fill-emerald-400 text-emerald-400" : "fill-amber-400 text-amber-400"} />
                        {i.avg_rating != null ? i.avg_rating.toFixed(1) : "—"} ({i.rating_count} rating{i.rating_count === 1 ? "" : "s"})
                      </span>
                      {i.calendly_url && (
                        <a href={i.calendly_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-500 hover:text-mint-600">
                          <ExternalLink size={11} />Calendly
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(i)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(i.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
