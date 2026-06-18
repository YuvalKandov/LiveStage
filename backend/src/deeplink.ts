import { HttpError } from "./util";

/**
 * Composes the final deep link from a template's base and the developer-supplied parameters
 * (build spec §4.1, §5.2): `base + percent-encoded query params`. The composed URL is what gets
 * frozen into the activity attributes at start. Custom schemes (e.g. `triptogether://trip`) are not
 * reliably parseable by the WHATWG URL class, so the query string is built and encoded by hand.
 */
export function composeDeepLink(base: string, params: Record<string, string>): string {
  if (typeof base !== "string" || !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) {
    throw new HttpError(400, "validation", `Invalid deep link base: ${String(base)}`, "deepLinkBase");
  }

  const query = Object.entries(params ?? {})
    .map(([key, value]) => {
      if (typeof value !== "string") {
        throw new HttpError(
          400,
          "validation",
          `Deep link parameter "${key}" must be a string.`,
          "deepLinkParameters",
        );
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");

  const composed = query ? `${base}?${query}` : base;

  // Reject anything that produced obviously malformed output (e.g. whitespace, control chars).
  if (/\s/.test(composed)) {
    throw new HttpError(400, "validation", `Composed deep link is malformed: ${composed}`, "deepLinkURL");
  }
  return composed;
}
