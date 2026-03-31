/**
 * Fetches a Google Doc as HTML and splits it into sections by headings.
 * Preserves hyperlinks (Loom URLs, etc.) that plain-text export strips.
 * Works for publicly shared docs (or "anyone with the link").
 */

import * as cheerio from "cheerio";

export interface DocSection {
  heading: string;
  content: string;
}

export interface ImportResult {
  title: string;
  sections: DocSection[];
}

const MAX_SECTION_CHARS = 4000;

/** Extract Google Doc ID from various URL formats */
function extractDocId(urlOrId: string): string {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Might already be a raw ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(urlOrId)) return urlOrId;
  throw new Error("Could not extract Google Doc ID from URL");
}

/** Detect if a line looks like a heading */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Too long to be a heading
  if (trimmed.length > 80) return false;
  // Skip standalone numbers (page numbers)
  if (/^\d+$/.test(trimmed)) return false;
  // Skip lines that start with bullets or special chars
  if (/^[∙•\-–—]/.test(trimmed)) return false;
  // Skip lines that look like sentences (start lowercase, end with period, contain commas)
  if (/^[a-z]/.test(trimmed)) return false;
  if (trimmed.endsWith(".") && trimmed.length > 40) return false;
  // Skip lines starting with "Closely related", "Greater description", "What the trait is not" — these are sub-descriptions
  if (/^(closely|greater|what the trait|regardless)/i.test(trimmed)) return false;
  // "Phase N:" or "Chapter N:" patterns
  if (/^(phase|chapter|section|part)\s+\d+/i.test(trimmed)) return true;
  // Title-case or question-style heading (starts with capital, 2-8 words, no trailing period)
  if (/^[A-Z]/.test(trimmed) && !trimmed.endsWith(".") && trimmed.split(/\s+/).length <= 10) {
    // Must look like a title: no commas in short headings, contains at least one letter word
    if (trimmed.length < 50 || /\?$/.test(trimmed)) return true;
  }
  return false;
}

/** Split content that exceeds max chars at paragraph boundaries */
function subSplit(heading: string, content: string): DocSection[] {
  if (content.length <= MAX_SECTION_CHARS) {
    return [{ heading, content }];
  }

  const paragraphs = content.split(/\n\n+/);
  const sections: DocSection[] = [];
  let current = "";
  let partNum = 1;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_SECTION_CHARS && current.length > 0) {
      sections.push({ heading: `${heading} (Part ${partNum})`, content: current.trim() });
      partNum++;
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) {
    sections.push({
      heading: partNum > 1 ? `${heading} (Part ${partNum})` : heading,
      content: current.trim(),
    });
  }
  return sections;
}

/** Convert an HTML element to text, inlining link URLs */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function htmlToText($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
  let result = "";
  el.contents().each((_, node) => {
    if (node.type === "text") {
      result += (node as unknown as { data: string }).data;
    } else if (node.type === "tag") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tag = node as any;
      const $tag = $(tag);
      if (tag.tagName === "a") {
        const href = $tag.attr("href") ?? "";
        const text = $tag.text();
        // Inline the URL if it's a real link and different from the visible text
        if (href && href.startsWith("http") && href !== text) {
          result += `${text} (${href})`;
        } else {
          result += text;
        }
      } else if (tag.tagName === "br") {
        result += "\n";
      } else if (["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag.tagName)) {
        result += "\n" + htmlToText($, $tag) + "\n";
      } else {
        result += htmlToText($, $tag);
      }
    }
  });
  return result;
}

export async function fetchGoogleDoc(docUrl: string): Promise<ImportResult> {
  const docId = extractDocId(docUrl);

  // Export as HTML to preserve hyperlinks (plain text export strips them)
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;

  const res = await fetch(exportUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Doc (HTTP ${res.status}). Make sure the doc is shared with "Anyone with the link".`);
  }

  const html = await res.text();
  if (!html.trim()) {
    throw new Error("Google Doc appears to be empty");
  }

  const $ = cheerio.load(html);

  // Extract title from the doc
  const title = $("title").text().trim() || $("body").find("p").first().text().trim() || "Untitled Document";

  // Convert HTML body to text with links preserved
  const text = htmlToText($, $("body"))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text.split("\n");

  // Split into sections by heading detection
  const rawSections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = title;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isHeadingLine(line)) {
      if (currentLines.some((l) => l.trim())) {
        rawSections.push({ heading: currentHeading, lines: [...currentLines] });
      }
      currentHeading = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.some((l) => l.trim())) {
    rawSections.push({ heading: currentHeading, lines: currentLines });
  }

  // Convert to sections, sub-splitting large ones
  const sections: DocSection[] = [];
  for (const raw of rawSections) {
    const content = raw.lines.join("\n").trim();
    if (!content) continue;
    sections.push(...subSplit(raw.heading, content));
  }

  return { title, sections };
}
