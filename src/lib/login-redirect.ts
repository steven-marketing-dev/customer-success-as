/**
 * Where to send the user after login (DIS-308).
 *
 * The middleware sends signed-out visitors to `/login?next=<path+query>` so a
 * deep link (e.g. the usage report's "Answer them" → `/?tab=dashboard`) lands
 * on the same page after signing in. Only same-origin paths are accepted, so
 * `next` can't be used as an open redirect.
 */

const BASE = "http://internal.invalid";

export function loginUrlFor(path: string, search = ""): string {
  const target = `${path}${search}`;
  if (target === "/" || !safeNextPath(target)) return "/login";
  return `/login?next=${encodeURIComponent(target)}`;
}

export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  // Must be a plain absolute path: no scheme, no protocol-relative "//", no "/\".
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // Control characters (tabs/newlines get stripped by URL parsers) are never legit here.
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // Don't bounce back to the login page or into API routes.
  if (url.pathname === "/login" || url.pathname.startsWith("/login/") || url.pathname.startsWith("/api/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
