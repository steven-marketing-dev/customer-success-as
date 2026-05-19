/**
 * Microsoft Clarity Data Export API client.
 *
 * Endpoint: GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 * Auth: Bearer token (CLARITY_API_TOKEN), project scoped via CLARITY_PROJECT_ID
 *
 * Constraints (paid plans only):
 *   - Max 3 days of data per call (numOfDays=1|2|3)
 *   - Max 10 calls per day per project
 *   - Each call may filter on up to 3 dimensions (Page, URL, Browser, Device, etc.)
 *
 * We sync 1 day at a time per dimension we care about, upserting into clarity_metrics
 * keyed on (date_bucket, dimension, dimension_value) so re-runs are idempotent.
 */

import { Repository } from "./db/repository";

type ClarityDimension = "Page" | "URL" | "Browser" | "Device";

interface ClarityRow {
  // The API returns metric arrays — each entry has an information array with one
  // object whose keys are metric names. The shape varies slightly between metrics.
  metricName: string;
  information: Array<Record<string, string | number>>;
}

interface ClarityResponse {
  // The Live Insights API returns an array per metric.
  // We aggregate per dimension_value.
  [key: string]: unknown;
}

export class ClarityClient {
  private projectId: string;
  private token: string;

  constructor() {
    this.projectId = process.env.CLARITY_PROJECT_ID ?? "";
    this.token = process.env.CLARITY_API_TOKEN ?? "";
  }

  static isConfigured(): boolean {
    return Boolean(process.env.CLARITY_API_TOKEN && process.env.CLARITY_PROJECT_ID);
  }

  private async fetchInsights(numOfDays: 1 | 2 | 3, dimension1: ClarityDimension): Promise<ClarityRow[]> {
    if (!ClarityClient.isConfigured()) {
      throw new Error("Clarity is not configured (missing CLARITY_API_TOKEN or CLARITY_PROJECT_ID)");
    }
    const url = new URL("https://www.clarity.ms/export-data/api/v1/project-live-insights");
    url.searchParams.set("numOfDays", String(numOfDays));
    url.searchParams.set("dimension1", dimension1);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Clarity API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as ClarityRow[] | ClarityResponse;
    return Array.isArray(data) ? data : [];
  }

  /** Sync the last day's data for Page and URL dimensions.
   *  Returns the number of rows upserted. */
  async syncDaily(): Promise<number> {
    const repo = new Repository();
    const today = new Date();
    today.setUTCDate(today.getUTCDate() - 1);
    const dateBucket = today.toISOString().slice(0, 10);

    // Clear yesterday's rows for the dimensions we're about to refresh, so any
    // dimension_value that no longer appears (e.g. dropped because friction was 0)
    // doesn't linger from a previous run.
    repo.clearClarityMetricsForDate(dateBucket, ["Page", "URL"]);

    let upserts = 0;

    for (const dimension of ["Page", "URL"] as const) {
      const rows = await this.fetchInsights(1, dimension);
      const merged = mergeMetricsByDimensionValue(rows);
      for (const [dimensionValue, m] of merged.entries()) {
        if (!dimensionValue) continue;
        // Skip rows where every metric is 0 — nothing useful to record.
        if (m.traffic === 0 && m.rage_click_sessions === 0 && m.dead_click_sessions === 0
          && m.excessive_scroll_sessions === 0 && m.quick_back_sessions === 0
          && m.js_error_sessions === 0) continue;
        repo.upsertClarityMetric({
          date_bucket: dateBucket,
          dimension,
          dimension_value: dimensionValue,
          traffic: m.traffic,
          rage_click_sessions: m.rage_click_sessions,
          dead_click_sessions: m.dead_click_sessions,
          excessive_scroll_sessions: m.excessive_scroll_sessions,
          quick_back_sessions: m.quick_back_sessions,
          js_error_sessions: m.js_error_sessions,
        });
        upserts++;
      }
    }

    return upserts;
  }
}

interface MergedMetrics {
  traffic: number;
  rage_click_sessions: number;
  dead_click_sessions: number;
  excessive_scroll_sessions: number;
  quick_back_sessions: number;
  js_error_sessions: number;
}

/** Clarity's Live Insights response has different field names per metric.
 *  Friction metrics (RageClick, DeadClick, etc.) typically use `subTotal` for
 *  the session count; PopularPages uses `totalSessionCount`. We try several
 *  fallbacks per metric since the API has been inconsistent across versions. */
function pickCount(item: Record<string, string | number>, candidates: string[]): number {
  for (const k of candidates) {
    if (item[k] === undefined || item[k] === null || item[k] === "") continue;
    const n = Number(item[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Map a Clarity metricName to the bucket it should increment + the candidate
 *  field names that hold its count. Returns null for metrics we don't track. */
function metricRoute(metric: string): { bucket: keyof MergedMetrics; fields: string[] } | null {
  const m = metric.toLowerCase();
  if (m === "traffic" || m === "popularpages") {
    return { bucket: "traffic", fields: ["totalSessionCount", "totalSessions", "sessionsCount", "subTotal"] };
  }
  if (m === "rageclickcount" || m === "rageclickmetric" || m === "rageclick") {
    return { bucket: "rage_click_sessions", fields: ["subTotal", "sessionsCount", "rageClickCount", "totalSessionCount"] };
  }
  if (m === "deadclickcount" || m === "deadclickmetric" || m === "deadclick") {
    return { bucket: "dead_click_sessions", fields: ["subTotal", "sessionsCount", "deadClickCount", "totalSessionCount"] };
  }
  if (m === "excessivescroll" || m === "excessivescrollmetric") {
    return { bucket: "excessive_scroll_sessions", fields: ["subTotal", "sessionsCount", "excessiveScrollCount", "totalSessionCount"] };
  }
  if (m === "quickbackclick" || m === "quickbackmetric" || m === "quickback") {
    return { bucket: "quick_back_sessions", fields: ["subTotal", "sessionsCount", "quickBackCount", "totalSessionCount"] };
  }
  if (m === "scripterrorcount" || m === "scripterrormetric" || m === "scripterror" || m === "scripterrors") {
    return { bucket: "js_error_sessions", fields: ["subTotal", "sessionsCount", "errorCount", "totalSessionCount"] };
  }
  return null;
}

function mergeMetricsByDimensionValue(rows: ClarityRow[]): Map<string, MergedMetrics> {
  const map = new Map<string, MergedMetrics>();

  const ensure = (key: string): MergedMetrics => {
    let m = map.get(key);
    if (!m) {
      m = {
        traffic: 0,
        rage_click_sessions: 0,
        dead_click_sessions: 0,
        excessive_scroll_sessions: 0,
        quick_back_sessions: 0,
        js_error_sessions: 0,
      };
      map.set(key, m);
    }
    return m;
  };

  for (const row of rows) {
    const route = metricRoute(String(row.metricName ?? ""));
    if (!route) continue;
    const items = Array.isArray(row.information) ? row.information : [];

    for (const item of items) {
      const key = pickDimensionValue(item);
      if (!key) continue;
      const value = pickCount(item, route.fields);
      if (value === 0) continue;
      ensure(key)[route.bucket] += value;
    }
  }

  return map;
}

function pickDimensionValue(row: Record<string, string | number>): string {
  // Different metric responses use different dimension key names; try common ones.
  const candidates = ["Url", "URL", "Page", "PageUrl", "PageURL", "Path", "DimensionValue", "url", "page"];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
