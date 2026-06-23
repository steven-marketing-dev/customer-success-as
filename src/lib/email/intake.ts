/**
 * Widget intake email sender (SendGrid).
 *
 * The chat widget's "create ticket" form forwards the visitor's message into the
 * connected HubSpot inbox as a real inbound email. HubSpot then creates a native
 * email-channel thread (channelId 1002) AND a ticket via the same inbox automation
 * that handles ordinary support emails — which is what the n8n auto-responder
 * (workflow Sh5UfOGspQeTPJps) needs to reply through. The visitor's original
 * message is preserved as the first message in that thread.
 *
 * SendGrid requires the `From:` address to be on a verified/authenticated domain,
 * so we cannot send "as" the visitor. Instead we send from WIDGET_INTAKE_FROM (a
 * verified address on our domain) and put the visitor's address in `Reply-To` and
 * as the first line of the body. HubSpot therefore associates WIDGET_INTAKE_FROM as
 * the ticket's contact; the n8n workflow is adjusted to address its reply to the
 * visitor's real email (read from the message), not the associated contact.
 *
 * Env: SENDGRID_API_KEY, WIDGET_INTAKE_FROM, HUBSPOT_INBOX_EMAIL.
 */

export interface WidgetIntakeEmail {
  visitorEmail: string;
  visitorName?: string | null;
  toInbox: string;
  subject: string;
  text: string;
  html?: string | null;
}

/** True only when all env needed to send the intake email is configured. */
export function isIntakeEmailConfigured(): boolean {
  return Boolean(
    process.env.SENDGRID_API_KEY &&
      process.env.WIDGET_INTAKE_FROM &&
      process.env.HUBSPOT_INBOX_EMAIL
  );
}

/** The connected HubSpot inbox address to deliver intake emails to. */
export function getInboxAddress(): string | undefined {
  return process.env.HUBSPOT_INBOX_EMAIL;
}

/**
 * Send the widget submission into the connected inbox via the SendGrid v3 Mail API.
 * Throws on missing config or a non-2xx response.
 */
export async function sendWidgetIntakeEmail(opts: WidgetIntakeEmail): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromAddress = process.env.WIDGET_INTAKE_FROM;
  if (!apiKey || !fromAddress) {
    throw new Error("SendGrid is not configured (SENDGRID_API_KEY / WIDGET_INTAKE_FROM)");
  }

  // Use the visitor's name/email as the From display name so it's recognizable in
  // the inbox, while the actual From address is our verified intake address.
  const fromName = opts.visitorName || opts.visitorEmail;

  const content: Array<{ type: string; value: string }> = [
    { type: "text/plain", value: opts.text },
  ];
  if (opts.html) content.push({ type: "text/html", value: opts.html });

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.toInbox }] }],
      from: { email: fromAddress, name: fromName },
      reply_to: { email: opts.visitorEmail, name: opts.visitorName || undefined },
      subject: opts.subject,
      content,
      // Disable SendGrid tracking so the visitor's original links are preserved
      // verbatim — click_tracking otherwise rewrites every URL into a branded
      // redirect, which corrupts links the autoresponder/KB may reference.
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SendGrid send failed (${res.status}): ${detail}`);
  }
}
