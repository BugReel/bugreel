/**
 * Decode a percent-encoded HTTP header value (e.g. X-User-Name / X-User-Email).
 *
 * A reverse proxy in front of this server may URL-encode non-ASCII identity
 * values before placing them in headers, because HTTP header values must be
 * ASCII (RFC 7230 §3.2.6). A Cyrillic / accented display name therefore arrives
 * as "%D0%9A%D1%81...". Decode it once so the value we persist (and later show
 * in the dashboard) is the real name, not the escape sequence.
 *
 * Safe by construction:
 *  - returns '' for null / undefined / empty
 *  - only decodes when the value actually looks percent-encoded (a %XX triplet
 *    is present), so plain ASCII values pass through byte-for-byte
 *  - falls back to the raw value if decodeURIComponent throws on malformed input
 */
export function decodeHeaderValue(v) {
  if (!v) return '';
  const s = String(v);
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
