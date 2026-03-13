"use client";

const PALETTE = [
  { bg: "bg-violet-100", text: "text-violet-700", bar: "bg-violet-500" },
  { bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-500" },
  { bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  { bg: "bg-orange-100", text: "text-orange-700", bar: "bg-orange-500" },
  { bg: "bg-pink-100", text: "text-pink-700", bar: "bg-pink-500" },
  { bg: "bg-teal-100", text: "text-teal-700", bar: "bg-teal-500" },
  { bg: "bg-indigo-100", text: "text-indigo-700", bar: "bg-indigo-500" },
  { bg: "bg-rose-100", text: "text-rose-700", bar: "bg-rose-500" },
];

export interface CategorySummary {
  id: number;
  name: string;
  description: string | null;
  count: number;
  examples: string[];
}

interface Props {
  categories: CategorySummary[];
  onSelect?: (id: number | null) => void;
  selectedId?: number | null;
}

export function CategoryGrid({ categories, onSelect, selectedId }: Props) {
  const max = Math.max(...categories.map((c) => c.count), 1);

  if (!categories.length) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-sm">No categories yet.</p>
        <p className="text-xs mt-1">Run the pipeline to generate the KB.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {categories.map((cat, i) => {
        const color = PALETTE[i % PALETTE.length];
        const pct = Math.max((cat.count / max) * 100, 2);
        const isSelected = selectedId === cat.id;

        return (
          <button
            key={cat.id}
            onClick={() => onSelect?.(isSelected ? null : cat.id)}
            className={`w-full text-left p-3 rounded-xl border transition-all ${
              isSelected
                ? "border-indigo-300 bg-indigo-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium truncate min-w-0 ${color.bg} ${color.text}`}
                title={cat.name}
              >
                {cat.name}
              </span>
              <span className="text-xs font-semibold text-slate-600 flex-shrink-0">
                {cat.count}
              </span>
            </div>

            {/* Bar */}
            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${color.bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
