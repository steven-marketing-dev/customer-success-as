/**
 * Report email sender (SendGrid v3), used by the widget usage reports (DIS-234).
 *
 * Sends from REPORTS_FROM (falls back to WIDGET_INTAKE_FROM), which must be a verified
 * SendGrid sender. Tracking is off so report links stay verbatim.
 *
 * Env: SENDGRID_API_KEY, REPORTS_FROM.
 */

export interface ReportEmail {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; type: string }>;
}

export function getReportsFrom(): string | undefined {
  return process.env.REPORTS_FROM || process.env.WIDGET_INTAKE_FROM;
}

export function isReportEmailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && getReportsFrom());
}

export async function sendReportEmail(opts: ReportEmail): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = getReportsFrom();
  if (!apiKey || !from) throw new Error("SendGrid is not configured (SENDGRID_API_KEY / REPORTS_FROM)");

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: { email: from, name: "CS Widget Reports" },
      subject: opts.subject,
      content: [{ type: "text/html", value: opts.html }],
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        type: a.type,
        disposition: "attachment",
        content: Buffer.from(a.content, "utf8").toString("base64"),
      })),
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SendGrid send failed (${res.status}): ${detail.slice(0, 500)}`);
  }
}
