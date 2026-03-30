import * as cheerio from "cheerio";

const REPORT_URL_PATTERN =
  /https?:\/\/reports\.discovered\.ai\/htmlreport(?:new)?\/[^\s)}\]"']+/gi;

const FETCH_TIMEOUT_MS = 10_000;

export interface ReportData {
  url: string;
  success: boolean;
  candidateName?: string;
  jobTitle?: string;
  overallRecommendation?: string;
  overallScore?: number;
  traits: Array<{
    name: string;
    score?: number;
    rating?: string;
    description?: string;
  }>;
  sections: Array<{ name: string; content: string }>;
  rawText?: string;
  error?: string;
}

/** Detect assessment report URLs in text */
export function detectReportUrls(text: string): string[] {
  const matches = text.match(REPORT_URL_PATTERN);
  if (!matches) return [];
  // Deduplicate
  return [...new Set(matches)];
}

/** Try to fetch and extract data from an assessment report URL */
export async function fetchReportData(url: string): Promise<ReportData> {
  const empty: ReportData = { url, success: false, traits: [], sections: [] };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ...empty, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Strategy 1: Look for embedded JSON state (common SPA pattern)
    let reportData: ReportData | null = null;

    $("script").each((_, el) => {
      const script = $(el).html() || "";

      // Look for window.__INITIAL_STATE__, window.__DATA__, etc.
      const statePatterns = [
        /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|$)/,
        /window\.__DATA__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|$)/,
        /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});?\s*(?:<\/script>|$)/,
        /"report(?:Data)?"\s*:\s*({[\s\S]*?})\s*[,;}\n]/,
      ];

      for (const pattern of statePatterns) {
        const match = script.match(pattern);
        if (match?.[1]) {
          try {
            const data = JSON.parse(match[1]);
            reportData = parseEmbeddedData(url, data);
          } catch {
            /* JSON parse failed, continue */
          }
        }
      }
    });

    if (reportData) return reportData;

    // Strategy 2: Try to extract any visible text content (SSR or partial render)
    $("script, style, iframe, noscript").remove();
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    if (bodyText.length > 50 && !bodyText.includes("You need to enable JavaScript")) {
      return {
        ...empty,
        success: true,
        rawText: bodyText.slice(0, 3000),
      };
    }

    // Strategy 3: Try API endpoints
    // Parse id and token from URL query params (e.g. ?id=1408302&token=THTNS)
    const parsedUrl = new URL(url);
    const reportId = parsedUrl.searchParams.get("id");
    const reportToken = parsedUrl.searchParams.get("token");
    const pathSegment = parsedUrl.pathname.split("/").filter(Boolean).pop() || "";

    const apiUrls: string[] = [];
    if (reportId) {
      const qs = reportToken ? `?token=${reportToken}` : "";
      // Try app.discovered.ai API (the main platform API)
      apiUrls.push(
        `https://app.discovered.ai/api/assessment/${reportId}${qs}`,
        `https://app.discovered.ai/api/report/${reportId}${qs}`,
        `https://app.discovered.ai/api/assessment/getinfo?id=${reportId}${reportToken ? `&token=${reportToken}` : ""}`,
      );
      // Try reports subdomain API
      apiUrls.push(
        `https://reports.discovered.ai/api/report/${reportId}${qs}`,
        `https://reports.discovered.ai/api/v1/report/${reportId}${qs}`,
      );
    } else if (pathSegment) {
      apiUrls.push(
        `https://reports.discovered.ai/api/report/${pathSegment}`,
        `https://app.discovered.ai/api/assessment/${pathSegment}`,
      );
    }

    if (apiUrls.length > 0) {

      for (const apiUrl of apiUrls) {
        try {
          const apiController = new AbortController();
          const apiTimeout = setTimeout(() => apiController.abort(), 5_000);
          const apiRes = await fetch(apiUrl, {
            signal: apiController.signal,
            headers: { Accept: "application/json" },
          });
          clearTimeout(apiTimeout);

          if (apiRes.ok) {
            const json = await apiRes.json();
            const parsed = parseEmbeddedData(url, json);
            if (parsed.success) return parsed;
          }
        } catch {
          /* API endpoint doesn't exist, continue */
        }
      }
    }

    return {
      ...empty,
      error: "Report page requires JavaScript rendering. Data could not be extracted automatically.",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { ...empty, error: "Report fetch timed out" };
    }
    return { ...empty, error: msg };
  }
}

/** Try to extract structured data from a JSON object (embedded state or API response) */
function parseEmbeddedData(
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): ReportData {
  const result: ReportData = { url, success: false, traits: [], sections: [] };

  if (!data || typeof data !== "object") return result;

  // Common field names for assessment data
  const candidateName =
    data.candidateName ?? data.candidate_name ?? data.candidate?.name ?? data.name;
  const jobTitle =
    data.jobTitle ?? data.job_title ?? data.position ?? data.candidate?.jobTitle;
  const recommendation =
    data.overallRecommendation ??
    data.overall_recommendation ??
    data.recommendation ??
    data.overallRating ??
    data.overall_rating;
  const score =
    data.overallScore ?? data.overall_score ?? data.totalScore ?? data.total_score;

  if (candidateName) result.candidateName = String(candidateName);
  if (jobTitle) result.jobTitle = String(jobTitle);
  if (recommendation) result.overallRecommendation = String(recommendation);
  if (score != null) result.overallScore = Number(score);

  // Extract traits/dimensions
  const traits =
    data.traits ?? data.dimensions ?? data.scores ?? data.traitScores ?? data.results;
  if (Array.isArray(traits)) {
    for (const t of traits) {
      if (typeof t === "object" && t) {
        result.traits.push({
          name: t.name ?? t.trait ?? t.dimension ?? t.label ?? "Unknown",
          score: t.score ?? t.value ?? t.rawScore,
          rating: t.rating ?? t.level ?? t.category,
          description: t.description ?? t.summary,
        });
      }
    }
  }

  // Extract sections
  const sections = data.sections ?? data.reportSections ?? data.categories;
  if (Array.isArray(sections)) {
    for (const s of sections) {
      if (typeof s === "object" && s) {
        result.sections.push({
          name: s.name ?? s.title ?? s.section ?? "Section",
          content:
            typeof s.content === "string"
              ? s.content.slice(0, 500)
              : JSON.stringify(s).slice(0, 500),
        });
      }
    }
  }

  result.success =
    !!result.candidateName ||
    !!result.overallRecommendation ||
    result.traits.length > 0;
  return result;
}

/** Format extracted report data as context for the AI system prompt */
export function formatReportContext(report: ReportData): string {
  if (!report.success && report.rawText) {
    return `Report URL: ${report.url}\nExtracted text:\n${report.rawText}`;
  }

  if (!report.success) return "";

  const lines: string[] = [`Report URL: ${report.url}`];

  if (report.candidateName) lines.push(`Candidate: ${report.candidateName}`);
  if (report.jobTitle) lines.push(`Position: ${report.jobTitle}`);
  if (report.overallRecommendation)
    lines.push(`Overall Recommendation: ${report.overallRecommendation}`);
  if (report.overallScore != null)
    lines.push(`Overall Score: ${report.overallScore}`);

  if (report.traits.length > 0) {
    lines.push("", "Trait Scores:");
    for (const t of report.traits) {
      const parts = [t.name];
      if (t.score != null) parts.push(`${t.score}`);
      if (t.rating) parts.push(`(${t.rating})`);
      lines.push(`- ${parts.join(": ")}`);
      if (t.description) lines.push(`  ${t.description}`);
    }
  }

  if (report.sections.length > 0) {
    for (const s of report.sections) {
      lines.push("", `${s.name}:`, s.content);
    }
  }

  // Truncate to ~2000 chars
  const full = lines.join("\n");
  return full.length > 2000 ? full.slice(0, 2000) + "\n..." : full;
}
