import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/tickets/models/Filter";

// Only sync tickets created on or after January 1, 2025
const START_DATE_MS = new Date("2025-01-01T00:00:00Z").getTime();

const TICKET_PROPERTIES = [
  "subject",
  "content",
  "hs_pipeline_stage",
  "hs_ticket_priority",
  "createdate",
  "hs_lastmodifieddate",
  "source_type",
];

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "webm", "mpeg", "mpg", "wmv", "3gp", "mkv"]);

export interface AttachmentImage {
  name: string;
  mimeType: string;
  data: string; // base64
}

export interface ConversationResult {
  text: string;
  images: AttachmentImage[];
}

interface RawTicket {
  id: string;
  properties: Record<string, string | null>;
}

interface ConversationMessage {
  sender: string;
  text: string;
  created_at: string;
}

export class HubSpotClient {
  private client: Client;
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.client = new Client({ accessToken });
  }

  async getTickets(opts: {
    modifiedAfter?: Date | null;
    limit?: number;
    closedOnly?: boolean;
  } = {}): Promise<RawTicket[]> {
    const { modifiedAfter, limit = 0, closedOnly = false } = opts;
    const all: RawTicket[] = [];
    let after: string | undefined;

    while (true) {
      const { results, paging } = modifiedAfter
        ? await this.searchTickets(modifiedAfter, after, closedOnly)
        : await this.listTickets(after, closedOnly);

      all.push(...results);

      if (limit > 0 && all.length >= limit) return all.slice(0, limit);
      if (!paging?.next?.after) break;
      after = paging.next.after;
    }

    return all;
  }

  private async listTickets(after?: string, closedOnly = false): Promise<{ results: RawTicket[]; paging: { next?: { after: string } } | null }> {
    const filters: Array<{ propertyName: string; operator: FilterOperatorEnum; value: string }> = [
      { propertyName: "createdate", operator: FilterOperatorEnum.Gte, value: String(START_DATE_MS) },
    ];
    if (closedOnly) {
      filters.push({ propertyName: "hs_pipeline_stage", operator: FilterOperatorEnum.Eq, value: "4" });
    }
    const res = await this.client.crm.tickets.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: TICKET_PROPERTIES,
      sorts: [],
      limit: 50,
      after: after ?? "",
    });

    return {
      results: res.results.map((t) => ({ id: t.id, properties: t.properties as Record<string, string | null> })),
      paging: res.paging ?? null,
    };
  }

  private async searchTickets(modifiedAfter: Date, after?: string, closedOnly = false): Promise<{ results: RawTicket[]; paging: { next?: { after: string } } | null }> {
    const tsMs = modifiedAfter.getTime();

    const filters: Array<{ propertyName: string; operator: FilterOperatorEnum; value: string }> = [
      { propertyName: "createdate", operator: FilterOperatorEnum.Gte, value: String(START_DATE_MS) },
      { propertyName: "hs_lastmodifieddate", operator: FilterOperatorEnum.Gte, value: String(tsMs) },
    ];
    if (closedOnly) {
      filters.push({ propertyName: "hs_pipeline_stage", operator: FilterOperatorEnum.Eq, value: "4" });
    }
    const res = await this.client.crm.tickets.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: TICKET_PROPERTIES,
      sorts: [],
      limit: 50,
      after: after ?? "",
    });

    return {
      results: res.results.map((t) => ({ id: t.id, properties: t.properties as Record<string, string | null> })),
      paging: res.paging ?? null,
    };
  }

  async getTicketConversation(hubspotTicketId: string): Promise<ConversationResult> {
    const parts: string[] = [];
    const images: AttachmentImage[] = [];

    // 1. CRM Email engagements (primary source for email-based tickets)
    try {
      const emailResult = await this.getTicketEmails(hubspotTicketId);
      if (emailResult.text) parts.push(emailResult.text);
      images.push(...emailResult.images);
    } catch { /* ignore */ }

    // 2. Conversations Threads API (for chat / inbox threads)
    try {
      const convIds = await this.getAssociatedIds(hubspotTicketId, "conversations");
      for (const id of convIds.slice(0, 2)) {
        const result = await this.getThreadMessages(id);
        if (result.text) parts.push(result.text);
        images.push(...result.images);
      }
    } catch { /* ignore */ }

    return {
      text: parts.join("\n\n---\n\n"),
      images,
    };
  }

  private async getTicketEmails(ticketId: string): Promise<ConversationResult> {
    const emailIds = await this.getAssociatedIds(ticketId, "emails");
    if (!emailIds.length) return { text: "", images: [] };

    const EMAIL_PROPS = [
      "hs_email_subject",
      "hs_email_text",
      "hs_email_direction",
      "hs_email_sender_email",
      "hs_email_sender_firstname",
      "hs_email_sender_lastname",
      "hs_timestamp",
      "hs_attachment_ids",
    ].join(",");

    const messages: ConversationMessage[] = [];
    const allImages: AttachmentImage[] = [];

    for (const id of emailIds.slice(0, 10)) {
      try {
        const res = await fetch(
          `https://api.hubapi.com/crm/v3/objects/emails/${id}?properties=${EMAIL_PROPS}`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (!res.ok) continue;

        const data = await res.json() as { properties?: Record<string, string | null> };
        const props = data.properties ?? {};

        const direction = props.hs_email_direction ?? "";
        const isIncoming = direction.includes("INCOMING") || direction === "FORWARDED_EMAIL";
        const firstName = props.hs_email_sender_firstname ?? "";
        const lastName = props.hs_email_sender_lastname ?? "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ");
        const senderEmail = props.hs_email_sender_email ?? "";
        const sender = isIncoming
          ? (fullName || senderEmail || "Customer")
          : (fullName || "Agent");

        let createdAt = props.hs_timestamp ?? "";
        try {
          createdAt = new Date(createdAt).toISOString().slice(0, 16).replace("T", " ");
        } catch { /* keep original */ }

        // Process attachments
        const attachmentIds = (props.hs_attachment_ids ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const attachmentNotes: string[] = [];

        for (const fileId of attachmentIds.slice(0, 5)) {
          const file = await this.getFileMetadata(fileId);
          if (!file) continue;

          const ext = file.extension.toLowerCase();

          if (IMAGE_MIME[ext] && file.size <= 4_000_000 && allImages.length < 5) {
            // Fetch image as base64 for multimodal processing
            const result = await this.fetchFileAsBase64(file.url);
            if (result) {
              allImages.push({ name: file.name, mimeType: result.mimeType, data: result.data });
              attachmentNotes.push(`[Image attached: ${file.name}]`);
            } else {
              attachmentNotes.push(`[Image (could not load): ${file.name}]`);
            }
          } else if (IMAGE_MIME[ext]) {
            attachmentNotes.push(`[Image (too large to process): ${file.name}]`);
          } else if (VIDEO_EXTENSIONS.has(ext)) {
            attachmentNotes.push(`[Video attached: ${file.name}]`);
          } else if (file.name) {
            attachmentNotes.push(`[Attachment: ${file.name}]`);
          }
        }

        let text = (props.hs_email_text ?? "").trim();
        if (attachmentNotes.length > 0) {
          text += (text ? "\n" : "") + attachmentNotes.join(" ");
        }
        if (!text) continue;

        messages.push({ sender, text, created_at: createdAt });
      } catch { /* skip this email */ }
    }

    // Sort chronologically (oldest first)
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at));

    return {
      text: messages.map((m) => `[${m.sender} - ${m.created_at}]: ${m.text}`).join("\n"),
      images: allImages,
    };
  }

  private async getFileMetadata(fileId: string): Promise<{ name: string; url: string; extension: string; size: number } | null> {
    try {
      const res = await fetch(
        `https://api.hubapi.com/files/v3/files/${fileId}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      if (!res.ok) return null;
      const data = await res.json() as { name?: string; url?: string; extension?: string; size?: number };
      return {
        name: data.name ?? fileId,
        url: data.url ?? "",
        extension: (data.extension ?? "").toLowerCase(),
        size: data.size ?? 0,
      };
    } catch {
      return null;
    }
  }

  private async fetchFileAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
    if (!url) return null;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        redirect: "follow",
      });
      if (!res.ok) return null;

      // Validate content-type is actually an image, not an HTML preview page
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) return null;

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 100 || buffer.byteLength > 4_000_000) return null;

      return {
        data: Buffer.from(buffer).toString("base64"),
        mimeType: contentType.split(";")[0].trim(),
      };
    } catch {
      return null;
    }
  }

  private async getAssociatedIds(ticketId: string, objectType: string): Promise<string[]> {
    try {
      const res = await fetch(
        `https://api.hubapi.com/crm/v4/objects/tickets/${ticketId}/associations/${objectType}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      if (!res.ok) return [];
      const data = await res.json() as { results?: Array<{ toObjectId: string }> };
      return (data.results ?? []).map((r) => String(r.toObjectId));
    } catch {
      return [];
    }
  }

  private async getThreadMessages(threadId: string): Promise<ConversationResult> {
    const messages: ConversationMessage[] = [];
    const threadImages: AttachmentImage[] = [];

    try {
      const res = await fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages?limit=50`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      if (!res.ok) return { text: "", images: [] };

      const data = await res.json() as { results?: Record<string, unknown>[] };

      for (const msg of (data.results ?? [])) {
        // Only process actual messages, skip system events
        if (msg.type !== "MESSAGE") continue;

        const senders = (msg.senders as Array<{ actorId?: string; name?: string; senderField?: string }>) ?? [];
        const senderInfo = senders[0];
        const actorId = senderInfo?.actorId ?? "";
        // Agent IDs start with "A-" or "V-", system with "S-"
        const isAgent = actorId.startsWith("A-") || actorId.startsWith("V-");
        const sender = isAgent
          ? (senderInfo?.name ?? "Agent")
          : (senderInfo?.name ?? "Customer");

        let createdAt = String(msg.createdAt ?? "");
        try {
          createdAt = new Date(createdAt).toISOString().slice(0, 16).replace("T", " ");
        } catch { /* keep original */ }

        // Try /original-content for full email text
        let text = "";
        try {
          const origRes = await fetch(
            `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages/${msg.id}/original-content`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
          );
          if (origRes.ok) {
            const orig = await origRes.json() as { text?: string; richText?: string };
            text = (orig.text ?? "").trim();
            if (!text && orig.richText) {
              // Strip HTML tags as fallback
              text = orig.richText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            }
          }
        } catch { /* fall through to msg.text */ }

        // Process image attachments from message object (CDN signed URLs)
        const msgAttachments = (msg.attachments as Array<{ type?: string; fileUsageType?: string; url?: string; name?: string }>) ?? [];
        for (const att of msgAttachments.slice(0, 5)) {
          if (att.fileUsageType !== "IMAGE" || !att.url || threadImages.length >= 5) continue;
          const result = await this.fetchFileAsBase64(att.url);
          if (result) {
            threadImages.push({ name: att.name ?? "image", mimeType: result.mimeType, data: result.data });
          }
        }

        // Fallback to message text/richText
        if (!text) {
          text = ((msg.text as string) ?? "").trim();
        }
        if (!text) {
          const richText = msg.richText;
          if (typeof richText === "string") {
            text = richText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
        }

        if (!text) continue;
        messages.push({ sender, text, created_at: createdAt });
      }
    } catch {
      return { text: "", images: [] };
    }

    // Sort chronologically
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at));

    return {
      text: messages.map((m) => `[${m.sender} - ${m.created_at}]: ${m.text}`).join("\n"),
      images: threadImages,
    };
  }

  // ─── Conversations Inbox ──────────────────────────────────────────────

  async searchConversationThreads(query?: string): Promise<Array<{
    threadId: string;
    subject: string | null;
    latestMessage: string | null;
    contactName: string | null;
    contactEmail: string | null;
    updatedAt: string | null;
    channelId: string | null;
    channelAccountId: string | null;
  }>> {
    try {
      type ThreadResult = {
        id: string;
        createdAt?: string;
        latestMessageTimestamp?: string;
        assignedTo?: string;
        associatedContactId?: string;
        originalChannelId?: string;
        originalChannelAccountId?: string;
        inboxId?: string;
        status?: string;
      };

      // Fetch threads sorted by latest activity (ascending), limited to last 90 days
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const openThreads: ThreadResult[] = [];
      let after: string | null = null;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
          limit: "500",
          sort: "latestMessageTimestamp",
          latestMessageTimestampAfter: String(ninetyDaysAgo),
        });
        if (after) params.set("after", after);

        const res = await fetch(
          `https://api.hubapi.com/conversations/v3/conversations/threads?${params}`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (!res.ok) {
          console.error("[hubspot] Thread search failed:", res.status, await res.text());
          break;
        }

        const data = await res.json() as {
          results?: ThreadResult[];
          paging?: { next?: { after?: string } };
        };

        for (const t of data.results ?? []) {
          if (t.status === "OPEN") openThreads.push(t);
        }

        after = data.paging?.next?.after ?? null;
        if (!after) break;
      }

      // Sort by most recent activity first (API returns ascending)
      const threads = openThreads.sort((a, b) =>
        new Date(b.latestMessageTimestamp ?? 0).getTime() - new Date(a.latestMessageTimestamp ?? 0).getTime()
      ).slice(0, 25);

      // Batch-fetch contact details for all threads that have associatedContactId
      const contactIds = [...new Set(threads.map((t) => t.associatedContactId).filter(Boolean))] as string[];
      const contactMap = new Map<string, { name: string | null; email: string | null }>();

      // Fetch contacts in parallel (batches of 10 to avoid rate limits)
      for (let i = 0; i < contactIds.length; i += 10) {
        const batch = contactIds.slice(i, i + 10);
        await Promise.all(
          batch.map(async (contactId) => {
            try {
              const contactRes = await fetch(
                `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname`,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
              );
              if (contactRes.ok) {
                const contact = await contactRes.json() as { properties?: { email?: string; firstname?: string; lastname?: string } };
                const p = contact.properties;
                contactMap.set(contactId, {
                  email: p?.email ?? null,
                  name: [p?.firstname, p?.lastname].filter(Boolean).join(" ") || null,
                });
              }
            } catch { /* skip */ }
          })
        );
      }

      // Batch-fetch first message per thread for subject/preview + sender fallback (batches of 10)
      const messageMap = new Map<string, { subject: string | null; text: string | null; senderName: string | null; senderEmail: string | null }>();
      for (let i = 0; i < threads.length; i += 10) {
        const batch = threads.slice(i, i + 10);
        await Promise.all(
          batch.map(async (t) => {
            try {
              const msgRes = await fetch(
                `https://api.hubapi.com/conversations/v3/conversations/threads/${t.id}/messages?limit=5`,
                { headers: { Authorization: `Bearer ${this.accessToken}` } }
              );
              if (msgRes.ok) {
                type MsgSender = { actorId?: string; name?: string; deliveryIdentifier?: { type?: string; value?: string } };
                const msgData = await msgRes.json() as { results?: Array<{ subject?: string; text?: string; type?: string; senders?: MsgSender[] }> };
                const messages = msgData.results ?? [];
                // Find the first actual MESSAGE (not status change) for subject/text
                const firstMsg = messages.find((m) => m.type === "MESSAGE");
                // Find the first non-agent sender for contact fallback
                const customerSender = messages.flatMap((m) => m.senders ?? []).find((s) => s.actorId && !s.actorId.startsWith("A-") && !s.actorId.startsWith("S-"));
                messageMap.set(t.id, {
                  subject: firstMsg?.subject ?? null,
                  text: firstMsg?.text?.slice(0, 200) ?? null,
                  senderName: customerSender?.name ?? null,
                  senderEmail: customerSender?.deliveryIdentifier?.type === "HS_EMAIL_ADDRESS" ? customerSender.deliveryIdentifier.value ?? null : null,
                });
              }
            } catch { /* skip */ }
          })
        );
      }

      const results = threads.map((t) => {
        const contact = t.associatedContactId ? contactMap.get(t.associatedContactId) : undefined;
        const msg = messageMap.get(t.id);
        return {
          threadId: t.id,
          subject: msg?.subject ?? null,
          latestMessage: msg?.text ?? null,
          contactName: contact?.name ?? msg?.senderName ?? null,
          contactEmail: contact?.email ?? msg?.senderEmail ?? null,
          updatedAt: t.latestMessageTimestamp ?? null,
          channelId: t.originalChannelId ?? null,
          channelAccountId: t.originalChannelAccountId ?? null,
        };
      });

      // Client-side filter if query provided
      if (query?.trim()) {
        const q = query.toLowerCase();
        return results.filter((r) =>
          (r.subject?.toLowerCase().includes(q)) ||
          (r.contactName?.toLowerCase().includes(q)) ||
          (r.contactEmail?.toLowerCase().includes(q)) ||
          (r.latestMessage?.toLowerCase().includes(q))
        );
      }

      return results;
    } catch (err) {
      console.error("[hubspot] Thread search error:", err);
      return [];
    }
  }

  /** Resolve the actor ID (A-{userId}) for the first HubSpot owner. */
  private async getSenderActorId(): Promise<string> {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/owners?limit=1`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    if (res.ok) {
      const data = await res.json() as { results?: Array<{ userId?: number }> };
      const userId = data.results?.[0]?.userId;
      if (userId) return `A-${userId}`;
    }
    throw new Error("Could not determine HubSpot sender — no owners found");
  }

  async replyToThread(threadId: string, opts: {
    html: string;
    subject?: string;
    plainText?: string;
    channelId: string;
    channelAccountId: string;
    contactEmail?: string;
    contactName?: string;
  }): Promise<{ messageId: string }> {
    const senderActorId = await this.getSenderActorId();

    // Strip HTML tags for plain text fallback
    const plainText = opts.plainText ?? opts.html.replace(/<[^>]*>/g, "").trim();

    // Build recipients for email channels
    const recipients = opts.contactEmail
      ? [{
          recipientField: "TO",
          deliveryIdentifiers: [{
            type: "HS_EMAIL_ADDRESS",
            value: opts.contactEmail,
          }],
        }]
      : undefined;

    const res = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "MESSAGE",
          senderActorId,
          text: plainText,
          richText: opts.html,
          subject: opts.subject,
          channelId: opts.channelId,
          channelAccountId: opts.channelAccountId,
          ...(recipients && { recipients }),
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HubSpot reply failed (${res.status}): ${errorText}`);
    }

    const data = await res.json() as { id?: string };
    return { messageId: data.id ?? "" };
  }

  static parseHubSpotDate(value: string | null | undefined): number | null {
    if (!value) return null;
    try {
      const ts = Number(value);
      if (!isNaN(ts)) return Math.floor(ts / 1000);
      return Math.floor(new Date(value).getTime() / 1000);
    } catch {
      return null;
    }
  }

  static mapChannel(sourceType: string | null | undefined): string {
    const map: Record<string, string> = {
      EMAIL: "email",
      CHAT: "chat",
      PHONE: "phone",
      FORM: "web_form",
    };
    return map[(sourceType ?? "").toUpperCase()] ?? "unknown";
  }
}
