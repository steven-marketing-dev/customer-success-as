/** Lightweight markdown→HTML. No headings (h1-h6), just inline formatting + lists + code blocks.
 *  Shared between the teammate AgentPanel and the external embed/chat widget. */
export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_m, code) => code.trimEnd());
  html = html.replace(/`([^`]+)`/g, "$1");

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="agent-link">$1</a>');

  html = html.replace(/\*{3}(.+?)\*{3}/g, "<strong><em>$1</em></strong>");
  html = html.replace(/_{3}(.+?)_{3}/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*{2}(.+?)\*{2}/g, "<strong>$1</strong>");
  html = html.replace(/_{2}(.+?)_{2}/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");

  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");

  const lines = html.split("\n");
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (olMatch) {
      if (!inOl) { result.push('<ol class="agent-ol">'); inOl = true; }
      if (inUl) { result.push("</ul>"); inUl = false; }
      result.push(`<li>${olMatch[2]}</li>`);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (ulMatch) {
      if (!inUl) { result.push('<ul class="agent-ul">'); inUl = true; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<li>${ulMatch[1]}</li>`);
      continue;
    }

    if (inUl) { result.push("</ul>"); inUl = false; }
    if (inOl) { result.push("</ol>"); inOl = false; }

    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      result.push('<hr class="agent-hr" />');
      continue;
    }

    if (line.trim() === "") {
      result.push('<div class="h-2"></div>');
    } else {
      result.push(`<p class="agent-p">${line}</p>`);
    }
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  return result.join("");
}
