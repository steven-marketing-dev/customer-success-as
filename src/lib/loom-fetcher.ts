/**
 * Loom video transcript fetcher.
 * Extracts Loom URLs from text, fetches transcripts via Loom's GraphQL API,
 * and parses VTT captions to plain text.
 */

const LOOM_URL_PATTERN = /https:\/\/(?:www\.)?loom\.com\/share\/([0-9a-f]{32})/g;

const LOOM_GRAPHQL_ENDPOINT = "https://www.loom.com/graphql";

const FETCH_CAPTIONS_QUERY = `query FetchCaptions($videoId: ID!, $password: String) {
  fetchVideoTranscript(videoId: $videoId, password: $password) {
    ... on VideoTranscriptDetails {
      id
      captions_source_url
      language
    }
    ... on GenericError {
      message
    }
  }
}`;

// ---------------------------------------------------------------------------
// extractLoomUrls
// ---------------------------------------------------------------------------

export function extractLoomUrls(
  text: string
): Array<{ url: string; videoId: string }> {
  const seen = new Set<string>();
  const results: Array<{ url: string; videoId: string }> = [];

  for (const match of text.matchAll(LOOM_URL_PATTERN)) {
    const url = match[0];
    const videoId = match[1];
    if (!seen.has(videoId)) {
      seen.add(videoId);
      results.push({ url, videoId });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// parseVTT
// ---------------------------------------------------------------------------

export function parseVTT(vtt: string): string {
  const lines = vtt.split(/\r?\n/);

  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip WEBVTT header
    if (trimmed.startsWith("WEBVTT")) continue;

    // Skip numeric cue identifiers
    if (/^\d+$/.test(trimmed)) continue;

    // Skip timestamp lines
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) continue;

    // Skip empty lines
    if (trimmed === "") continue;

    // Strip alignment/position tags like <v ...>, </v>, align:start, position:...
    const cleaned = trimmed
      .replace(/<[^>]+>/g, "")
      .replace(/\b(?:align|position|line|size):[^\s]+/g, "")
      .trim();

    if (cleaned) {
      textLines.push(cleaned);
    }
  }

  return textLines.join(" ").replace(/\s{2,}/g, " ").trim();
}

// ---------------------------------------------------------------------------
// fetchLoomTranscript
// ---------------------------------------------------------------------------

export async function fetchLoomTranscript(
  videoId: string
): Promise<{ transcript: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    // Step 1: Query Loom GraphQL for captions source URL
    const graphqlResponse = await fetch(LOOM_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apollographql-client-name": "web",
      },
      body: JSON.stringify({
        operationName: "FetchCaptions",
        variables: { videoId },
        query: FETCH_CAPTIONS_QUERY,
      }),
      signal: controller.signal,
    });

    if (!graphqlResponse.ok) {
      console.error(
        `[loom-fetcher] GraphQL request failed: ${graphqlResponse.status} ${graphqlResponse.statusText}`
      );
      return null;
    }

    const graphqlData = await graphqlResponse.json();

    // Step 2: Extract captions_source_url
    const transcript = graphqlData?.data?.fetchVideoTranscript;

    if (!transcript) {
      console.error("[loom-fetcher] No transcript data in response");
      return null;
    }

    if ("message" in transcript) {
      console.error(
        `[loom-fetcher] Loom returned error: ${transcript.message}`
      );
      return null;
    }

    const captionsUrl = transcript.captions_source_url;
    if (!captionsUrl) {
      console.error("[loom-fetcher] No captions_source_url found");
      return null;
    }

    // Step 3: Fetch the VTT content
    const vttResponse = await fetch(captionsUrl, {
      signal: controller.signal,
    });

    if (!vttResponse.ok) {
      console.error(
        `[loom-fetcher] VTT fetch failed: ${vttResponse.status} ${vttResponse.statusText}`
      );
      return null;
    }

    const vttContent = await vttResponse.text();

    // Step 4: Parse VTT to plain text
    const plainText = parseVTT(vttContent);

    if (!plainText) {
      console.error("[loom-fetcher] Parsed transcript is empty");
      return null;
    }

    return { transcript: plainText };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[loom-fetcher] Request timed out for video ${videoId}`);
    } else {
      console.error(`[loom-fetcher] Error fetching transcript:`, error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
