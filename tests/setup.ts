/**
 * Test setup (DIS-412). Import this first in every test file: it points the app at a throwaway
 * SQLite file and replaces the global fetch, so nothing leaves the machine. SendGrid and
 * Product Fruits get canned answers; any other host throws. No real keys are ever needed.
 */
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-kb-test-"));
process.env.DATABASE_PATH = path.join(dir, "kb.db");
process.env.MASTER_USERNAME = "admin";
process.env.MASTER_PASSWORD = "test-only";
process.env.AUTH_SECRET = "test-only-secret";
process.env.SENDGRID_API_KEY = "fake";
process.env.REPORTS_FROM = "reports@example.com";
process.env.WIDGET_INTAKE_FROM = "intake@example.com";
process.env.HUBSPOT_INBOX_EMAIL = "inbox@example.com";
process.env.PRODUCT_FRUITS_API_TOKEN = "fake";
process.env.N8N_API_KEY = "test-n8n-key";
delete process.env.HUBSPOT_ACCESS_TOKEN;
delete process.env.CALENDLY_API_TOKEN;
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

export const mock = {
  /** Emails accepted by the fake SendGrid */
  sent: [] as Array<{ to: string; subject: string }>,
  sendgridStatus: 202,
  /** Product Fruits listing calls, and how many were in flight at once */
  pfListings: 0,
  pfMaxConcurrentListings: 0,
  pfDelayMs: 0,
};
let pfInFlight = 0;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.sendgrid.com") {
    if (mock.sendgridStatus !== 202) return new Response("mock failure", { status: mock.sendgridStatus });
    const body = JSON.parse(String(init?.body)) as { subject: string; personalizations: Array<{ to: Array<{ email: string }> }> };
    mock.sent.push({ to: body.personalizations[0].to[0].email, subject: body.subject });
    return new Response(null, { status: 202 });
  }
  if (url.hostname === "api.productfruits.com") {
    if (url.pathname.endsWith("/articles")) {
      mock.pfListings++;
      pfInFlight++;
      mock.pfMaxConcurrentListings = Math.max(mock.pfMaxConcurrentListings, pfInFlight);
      await new Promise((r) => setTimeout(r, mock.pfDelayMs));
      pfInFlight--;
      return json({ articles: [1, 2].map((i) => ({
        id: String(i), lastModified: "2026-11-01T00:00:00Z", categoryId: 1, isPrivate: false, isHidden: false,
        contents: [{ id: `c${i}`, lang: "en", published: true, lastModified: "2026-11-01T00:00:00Z" }],
      })) });
    }
    if (url.pathname.endsWith("/categories")) return json({ categories: [{ id: 1, contents: [{ lang: "en", title: "Getting started" }] }] });
    const m = /pf_(\d+)\/content/.exec(url.pathname);
    if (m) return json({ articleId: Number(m[1]), title: `Article ${m[1]}`, slug: `article-${m[1]}`, lead: "", published: true, lastModified: "2026-11-01T00:00:00Z", content: `<p>Body of article ${m[1]}</p>` });
  }
  throw new Error(`[tests] blocked outbound request to ${url.hostname}`);
};

/** YYYY-MM-DD of today + offsetDays in `tz`. */
export function localDate(tz: string, offsetDays: number): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}
