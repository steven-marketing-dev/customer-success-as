// Rewrite any calendly.com link in model output to the configured scheduling
// URL. The KB contains many real reps' Calendly links in past ticket answers
// (e.g. anna-discovered, mitchel-discovered), and the model can reproduce one
// from retrieved context instead of using the intended link. This guarantees
// the correct link regardless of what the model emits.
//
// When no URL is configured (e.g. the machine-to-machine answer endpoint),
// calendly links are stripped entirely so a stray rep's link is never surfaced.
export function sanitizeCalendlyLinks(text: string, configuredUrl: string | null | undefined): string {
  const calendlyRe = /(https?:\/\/)?calendly\.com\/[^\s)\]>"']+/gi;
  if (configuredUrl) {
    return text.replace(calendlyRe, (match) => {
      const trailing = match.match(/[.,;:!?]+$/)?.[0] ?? "";
      return configuredUrl + trailing;
    });
  }
  // No configured URL: drop calendly links entirely (markdown form first, then bare).
  return text
    .replace(/\[[^\]]*\]\((https?:\/\/)?calendly\.com\/[^\s)]+\)/gi, "")
    .replace(calendlyRe, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** Tag a scheduling link so a booking made from the widget can be found later through the
 *  Calendly API (Calendly stores utm_* on the invitee's `tracking`). Used both client-side
 *  (menu button) and server-side (links inside chat answers). */
export const WIDGET_UTM_SOURCE = "cs-widget";

export function withWidgetUtm(url: string, installationId: number, sessionId: string | null): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", WIDGET_UTM_SOURCE);
    u.searchParams.set("utm_medium", `installation-${installationId}`);
    if (sessionId) u.searchParams.set("utm_content", sessionId);
    return u.toString();
  } catch {
    return url;
  }
}
