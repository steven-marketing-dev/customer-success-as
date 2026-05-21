import type { WidgetRating } from "@/lib/db/index";

export interface WidgetReportData {
  installation: { id: number; name: string; product_name: string | null };
  range: { days: number; since: number };
  top_questions: Array<{ question_norm: string; sample_question: string; count: number; last_asked_at: number }>;
  top_article_clicks: Array<{ article_url: string; article_title: string; clicks: number; last_clicked_at: number }>;
  rating_breakdown: { total: number; avg: number | null; by_rating: { 1: number; 2: number; 3: number } };
  ratings_feed: WidgetRating[];
  volume_by_day: Array<{ day: string; questions: number; ratings: number; clicks: number }>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function buildWidgetAnalyticsHtml(
  data: WidgetReportData,
  opts: { days: number; ratingFilter: 1 | 2 | 3 | null },
): string {
  const { days, ratingFilter } = opts;

  const maxVolume = Math.max(
    1,
    ...data.volume_by_day.flatMap((d) => [d.questions, d.ratings, d.clicks]),
  );

  const volumeRows = data.volume_by_day.map((d) => {
    const total = d.questions + d.ratings + d.clicks;
    const pct = (n: number) => `${Math.round((n / maxVolume) * 100)}%`;
    return `
      <tr>
        <td>${d.day}</td>
        <td class="num">${d.questions}</td>
        <td class="num">${d.ratings}</td>
        <td class="num">${d.clicks}</td>
        <td class="num"><strong>${total}</strong></td>
        <td class="bar">
          <span class="bar-q" style="width:${pct(d.questions)}"></span>
          <span class="bar-r" style="width:${pct(d.ratings)}"></span>
          <span class="bar-c" style="width:${pct(d.clicks)}"></span>
        </td>
      </tr>`;
  }).join("");

  const topQuestionRows = data.top_questions.length === 0
    ? `<tr><td colspan="3" class="empty">No questions in this window.</td></tr>`
    : data.top_questions.map((q) => `
        <tr>
          <td class="num"><strong>${q.count}</strong></td>
          <td>${escapeHtml(q.sample_question)}</td>
          <td class="muted">${formatDate(q.last_asked_at)}</td>
        </tr>`).join("");

  const topClickRows = data.top_article_clicks.length === 0
    ? `<tr><td colspan="3" class="empty">No article clicks in this window.</td></tr>`
    : data.top_article_clicks.map((a) => `
        <tr>
          <td class="num"><strong>${a.clicks}</strong></td>
          <td>${escapeHtml(a.article_title)}<br /><span class="muted url">${escapeHtml(a.article_url)}</span></td>
          <td class="muted">${formatDate(a.last_clicked_at)}</td>
        </tr>`).join("");

  const labels: Record<1 | 2 | 3, string> = { 1: "Not helpful", 2: "OK", 3: "Great" };
  const ratingsRows = data.ratings_feed.length === 0
    ? `<div class="empty">No ratings in this window${ratingFilter ? " for this filter" : ""}.</div>`
    : data.ratings_feed.map((r) => `
        <div class="rating-card rating-${r.rating}">
          <div class="rating-head">
            <span class="rating-pill rating-pill-${r.rating}">${"★".repeat(r.rating)} ${labels[r.rating]}</span>
            <span class="muted small">${formatDate(r.created_at)}</span>
          </div>
          <div class="rating-block">
            <div class="rating-label">Question</div>
            <div class="rating-text">${escapeHtml(r.question)}</div>
          </div>
          <div class="rating-block">
            <div class="rating-label">Answer shown</div>
            <div class="rating-text pre">${escapeHtml(r.answer)}</div>
          </div>
          ${r.feedback ? `
            <div class="rating-block">
              <div class="rating-label">User feedback</div>
              <div class="rating-text pre">${escapeHtml(r.feedback)}</div>
            </div>` : ""}
        </div>`).join("");

  const br = data.rating_breakdown;
  const generatedAt = new Date().toLocaleString();
  const installName = data.installation.name;
  const productName = data.installation.product_name ?? "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Widget analytics — ${escapeHtml(installName)}</title>
<style>
  :root {
    --ink: #0C1222;
    --muted: #64748b;
    --line: #e2e8f0;
    --bg: #ffffff;
    --mint: #0d9488;
    --red: #dc2626;
    --amber: #d97706;
    --emerald: #059669;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--ink);
    background: var(--bg);
    margin: 0;
    padding: 32px 36px 48px;
    font-size: 12px;
    line-height: 1.45;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
  header .meta { color: var(--muted); font-size: 11px; }
  h2 {
    font-size: 13px; margin: 22px 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid var(--line); letter-spacing: 0.02em;
    text-transform: uppercase; color: var(--ink);
  }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; width: 60px; }
  td.muted, .muted { color: var(--muted); }
  .small { font-size: 10px; }
  .empty { color: var(--muted); font-style: italic; padding: 12px 0; text-align: center; }
  .summary {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    margin-top: 10px;
  }
  .summary .stat {
    border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px;
  }
  .summary .stat .label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .summary .stat .val { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .legend { display: flex; gap: 14px; font-size: 10px; color: var(--muted); margin-top: 6px; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .legend .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .sw-q { background: var(--ink); }
  .sw-r { background: var(--amber); }
  .sw-c { background: var(--mint); }
  td.bar { width: 220px; padding: 8px; }
  td.bar span { display: inline-block; height: 6px; border-radius: 2px; margin-right: 2px; vertical-align: middle; }
  td.bar .bar-q { background: var(--ink); }
  td.bar .bar-r { background: var(--amber); }
  td.bar .bar-c { background: var(--mint); }
  .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; word-break: break-all; }

  .rating-card {
    border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px;
    margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid;
  }
  .rating-1 { border-left: 3px solid var(--red); }
  .rating-2 { border-left: 3px solid var(--amber); }
  .rating-3 { border-left: 3px solid var(--emerald); }
  .rating-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .rating-pill { font-size: 10px; padding: 2px 6px; border-radius: 999px; font-weight: 600; }
  .rating-pill-1 { background: #fee2e2; color: var(--red); }
  .rating-pill-2 { background: #fef3c7; color: var(--amber); }
  .rating-pill-3 { background: #d1fae5; color: var(--emerald); }
  .rating-block { margin-top: 4px; }
  .rating-label { font-size: 9px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; margin-bottom: 1px; }
  .rating-text { font-size: 11px; }
  .rating-text.pre { white-space: pre-wrap; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media print {
    body { padding: 16px 18px; }
    h2 { page-break-after: avoid; }
    .no-print { display: none !important; }
  }
  .actions {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 8px 0; margin: -32px -36px 16px; padding: 10px 36px;
    background: rgba(255,255,255,0.95); backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }
  .actions button {
    font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 6px;
    border: 1px solid var(--line); background: white; cursor: pointer;
  }
  .actions button.primary { background: var(--mint); color: white; border-color: var(--mint); }
</style>
</head>
<body>
  <div class="actions no-print">
    <button onclick="window.print()" class="primary">Save as PDF</button>
    <button onclick="window.close()">Close tab</button>
  </div>

  <header>
    <h1>Widget analytics — ${escapeHtml(installName)}${productName ? ` <span class="muted small">(${escapeHtml(productName)})</span>` : ""}</h1>
    <div class="meta">
      Last ${days} days${ratingFilter ? ` · rating filter: ${ratingFilter}★` : ""}
      · generated ${escapeHtml(generatedAt)}
    </div>
  </header>

  <h2>Summary</h2>
  <div class="summary">
    <div class="stat"><div class="label">Questions</div><div class="val">${data.volume_by_day.reduce((a, d) => a + d.questions, 0)}</div></div>
    <div class="stat"><div class="label">Ratings</div><div class="val">${br.total}</div></div>
    <div class="stat"><div class="label">Avg rating</div><div class="val">${br.avg != null ? br.avg.toFixed(2) : "—"}<span class="muted small"> / 3</span></div></div>
    <div class="stat"><div class="label">Article clicks</div><div class="val">${data.volume_by_day.reduce((a, d) => a + d.clicks, 0)}</div></div>
  </div>

  <h2>Daily volume</h2>
  <div class="legend">
    <span><span class="sw sw-q"></span>Questions</span>
    <span><span class="sw sw-r"></span>Ratings</span>
    <span><span class="sw sw-c"></span>Article clicks</span>
  </div>
  <table>
    <thead><tr><th>Date</th><th class="num">Q</th><th class="num">R</th><th class="num">C</th><th class="num">Total</th><th>Distribution</th></tr></thead>
    <tbody>${volumeRows || `<tr><td colspan="6" class="empty">No activity recorded.</td></tr>`}</tbody>
  </table>

  <div class="two-col">
    <div>
      <h2>Top questions</h2>
      <table>
        <thead><tr><th class="num">#</th><th>Question</th><th>Last asked</th></tr></thead>
        <tbody>${topQuestionRows}</tbody>
      </table>
    </div>
    <div>
      <h2>Most-clicked articles</h2>
      <table>
        <thead><tr><th class="num">#</th><th>Article</th><th>Last clicked</th></tr></thead>
        <tbody>${topClickRows}</tbody>
      </table>
    </div>
  </div>

  <h2>Rating breakdown</h2>
  <table>
    <thead><tr><th>Rating</th><th class="num">Count</th><th class="num">% of rated</th></tr></thead>
    <tbody>
      <tr><td>★★★ Great</td><td class="num">${br.by_rating[3]}</td><td class="num">${br.total ? Math.round(100 * br.by_rating[3] / br.total) : 0}%</td></tr>
      <tr><td>★★ OK</td><td class="num">${br.by_rating[2]}</td><td class="num">${br.total ? Math.round(100 * br.by_rating[2] / br.total) : 0}%</td></tr>
      <tr><td>★ Not helpful</td><td class="num">${br.by_rating[1]}</td><td class="num">${br.total ? Math.round(100 * br.by_rating[1] / br.total) : 0}%</td></tr>
    </tbody>
  </table>

  <h2>Ratings feed ${ratingFilter ? `<span class="muted small">(filtered: ${ratingFilter}★)</span>` : ""}</h2>
  ${ratingsRows}
</body>
</html>`;
}
