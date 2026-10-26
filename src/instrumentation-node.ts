import { syncFromProductFruits } from "./lib/productFruits";

export { scheduleWidgetReports } from "./lib/widget-report-scheduler";

/**
 * Schedules the Product Fruits KB sync inside the server process so kb_articles stays
 * current without anyone pressing "Scrape KB".
 *
 * KB_SYNC_INTERVAL_HOURS (default 6, 0 disables). Only runs in production with a PF token.
 */
export function scheduleKbSync() {
  if (process.env.NODE_ENV !== "production" || !process.env.PRODUCT_FRUITS_API_TOKEN) return;

  const hours = Number(process.env.KB_SYNC_INTERVAL_HOURS ?? "6");
  if (!Number.isFinite(hours) || hours <= 0) return;

  const run = () =>
    syncFromProductFruits({ onLog: (m) => console.log(`[kb-sync] ${m}`) }).catch((err) =>
      console.error("[kb-sync] failed:", err),
    );

  // First run one full interval after boot, not right away: after a fresh token or a deploy
  // there is time to run POST /api/kb/sync with dryRun first.
  setInterval(run, hours * 60 * 60 * 1000);
  console.log(`[kb-sync] Product Fruits sync scheduled every ${hours}h`);
}
