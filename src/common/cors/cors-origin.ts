/**
 * Parses the `CORS_ORIGIN` env value (comma-separated) into the allow-list that
 * `enableCors` accepts. Plain entries stay exact-match strings; an entry with a
 * `*.` wildcard (e.g. `https://*.oliverhatherton.com`) becomes an **anchored**
 * regex matching one or more subdomain labels.
 *
 * The anchoring (`^…$`) and the required dot before the domain are deliberate:
 * `https://*.oliverhatherton.com` matches `https://demo.oliverhatherton.com`
 * and `https://a.b.oliverhatherton.com`, but NOT the apex
 * (`https://oliverhatherton.com`), a look-alike (`https://eviloliverhatherton.com`)
 * or a suffix trick (`https://oliverhatherton.com.evil.com`).
 */
export function buildCorsOrigins(raw: string): (string | RegExp)[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toOriginMatcher);
}

function toOriginMatcher(entry: string): string | RegExp {
  if (!entry.includes('*')) {
    return entry;
  }
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `^${escaped.replace('\\*\\.', '([a-z0-9-]+\\.)+')}$`;
  return new RegExp(pattern, 'i');
}
