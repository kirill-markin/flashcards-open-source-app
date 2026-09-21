/**
 * Which registrable domain a browser cookie is published on, decided per request.
 *
 * Mirrors apps/backend/src/shared/cookieDomain.ts exactly, down to the normalization, and reads the
 * same `COOKIE_DOMAIN` value. Both services MUST resolve the same domain for the same host: the
 * session cookies minted here and the `analytics_visitor` cookie the backend mints are read across
 * the hosts under that domain, so a disagreement splits one browser into two visitors and leaves a
 * session the API cannot see. The auth Lambda is deliberately dependency-light and cannot import the
 * backend package, so the helper is duplicated here.
 *
 * Why it is per-request at all: two registrable domains serve browsers at once, and a cookie carries
 * one explicit `Domain`. RFC 6265 section 5.3.6 makes a browser discard a `Set-Cookie` whose
 * `Domain` is not the request host or a parent of it, so a single configured value silently breaks
 * every host under the other domain. `auth.<base domain>` in particular stays the pinned OAuth
 * authorization server every MCP client was issued (`publicUrls.ts`), so its cookies have to keep
 * working for as long as those clients exist.
 *
 * `COOKIE_DOMAIN` carries the candidate set as a comma-separated list, the grammar
 * `ALLOWED_REDIRECT_URIS` already uses. A single value is a one-candidate set and behaves as it
 * always has for every host under it.
 */

/**
 * Normalizes a `Host` header into a comparable hostname: lower-cased, without a port, without a
 * trailing root dot, and without surrounding whitespace. Returns `null` when there is nothing usable
 * to compare. The value is client-controlled, so it is only ever compared against configured names.
 */
function normalizeRequestHost(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") {
    return null;
  }

  // IPv6 literals keep their brackets; only a trailing `:port` is dropped.
  const withoutPort = trimmed.startsWith("[")
    ? trimmed.replace(/](:\d+)$/, "]")
    : trimmed.replace(/:\d+$/, "");
  const withoutRootDot = withoutPort.replace(/\.$/, "");

  return withoutRootDot === "" ? null : withoutRootDot;
}

/** Normalized, de-duplicated candidates. An unset or empty value yields none, and each caller owns what that means. */
export function parseCookieDomainCandidates(rawValue: string | undefined): ReadonlyArray<string> {
  const candidates = (rawValue ?? "")
    .split(",")
    .map((candidate) => normalizeRequestHost(candidate))
    .filter((candidate): candidate is string => candidate !== null);

  return Array.from(new Set(candidates));
}

/**
 * The candidate this request's host sits under, or an error.
 *
 * A host matching nothing is refused rather than given the first candidate: handing it one produces
 * precisely the `Set-Cookie` the browser discards, and the sign-in then appears to have succeeded
 * while storing nothing. A misconfigured deployment fails loudly on its first cookie instead.
 *
 * Where several candidates match, the host sits under all of them, so each is a suffix of the next
 * and the longest is the most specific. It wins, because a broader one would also publish the cookie
 * to the siblings the operator carved out by listing the narrower name.
 */
export function resolveCookieDomain(
  requestHost: string | null | undefined,
  candidates: ReadonlyArray<string>,
): string {
  const host = normalizeRequestHost(requestHost);
  if (host === null) {
    throw new Error(
      `Request carries no usable Host header, so no cookie domain can be resolved from COOKIE_DOMAIN (${candidates.join(", ")})`,
    );
  }

  const matched = candidates
    .filter((candidate) => host === candidate || host.endsWith(`.${candidate}`))
    .sort((left, right) => right.length - left.length)[0];
  if (matched === undefined) {
    throw new Error(
      `Host ${host} is not under any COOKIE_DOMAIN candidate (${candidates.join(", ")}), so a cookie set here would be discarded by the browser`,
    );
  }

  return matched;
}
