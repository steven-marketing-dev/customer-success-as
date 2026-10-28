/**
 * Sends a widget submission to support: the email form and "Not helpful" follow-up requests.
 *
 * Preferred path: forward it into the connected HubSpot inbox as a real inbound email. HubSpot
 * creates a native email-channel thread + ticket, so the n8n auto-responder has a thread to reply
 * through and the original message is preserved. Falls back to the direct CRM-ticket path when
 * the intake email env isn't configured, so submissions never break during rollout.
 */
import { HubSpotClient } from "@/lib/hubspot";
import type { WidgetInstallation } from "@/lib/db/index";
import { isIntakeEmailConfigured, getInboxAddress, sendWidgetIntakeEmail } from "@/lib/email/intake";

export type IntakeVia = "inbound_email" | "crm_ticket";

/** How the submission was sent; ticketId only on the CRM-ticket path (HubSpot returns no id for an inbound email). */
export interface IntakeResult { via: IntakeVia; ticketId?: string }

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isWidgetIntakeConfigured(): boolean {
  return isIntakeEmailConfigured() || Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

export async function submitWidgetIntake(data: {
  installation: Pick<WidgetInstallation, "product_name">;
  subject: string;
  description: string;
  email: string;
  sourceUrl: string | null;
  sessionId: string | null;
  /** Extra footer line, e.g. where in the widget the request came from */
  origin?: string;
}): Promise<IntakeResult> {
  if (isIntakeEmailConfigured()) {
    // Human-readable body: the visitor's message first, then a metadata footer.
    // The "Visitor email:" line is parsed by the n8n workflow to address the reply
    // to the visitor (HubSpot sets the ticket contact to the intake address, not
    // the visitor, on this inbound email).
    const footer: string[] = [`Visitor email: ${data.email}`];
    if (data.installation.product_name) footer.push(`Product: ${data.installation.product_name}`);
    if (data.sourceUrl) footer.push(`Page: ${data.sourceUrl}`);
    if (data.sessionId) footer.push(`Widget session: ${data.sessionId}`);
    if (data.origin) footer.push(data.origin);
    footer.push("Submitted via the help widget");
    await sendWidgetIntakeEmail({
      visitorEmail: data.email,
      toInbox: getInboxAddress()!,
      subject: data.subject,
      text: `${data.description}\n\n—\n${footer.join("\n")}`,
    });
    return { via: "inbound_email" };
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("Ticket backend not configured");
  const ticket = await new HubSpotClient(token).createWidgetTicket({
    subject: data.subject,
    description: data.origin ? `${data.description}\n\n${data.origin}` : data.description,
    fromEmail: data.email,
    sourceUrl: data.sourceUrl,
    productName: data.installation.product_name,
  });
  return { via: "crm_ticket", ticketId: ticket.id };
}
