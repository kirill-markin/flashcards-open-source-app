/**
 * Which registrable domain a browser cookie is published on, decided per request.
 *
 * Two registrable domains serve browsers at once — the product base domain and the domain the
 * clients are being moved to — and a cookie carries one explicit `Domain`. RFC 6265 section 5.3.6
 * makes a browser discard a `Set-Cookie` whose `Domain` is not the request host or a parent of it,
 * so any single configured value silently breaks every host under the other domain: the session
 * that stores nothing, the visitor id that never arrives. The domain is therefore a per-request fact
 * derived from `Host`, exactly as the MCP protected-resource identifier is (../mcp/hosts.ts).
 *
 * `COOKIE_DOMAIN` carries the candidate set as a comma-separated list, the grammar
 * `ALLOWED_REDIRECT_URIS` already uses. A single value is a one-candidate set and behaves as it
 * always has for every host under it.
 *
 * The auth service resolves the same way from the same variable
 * (apps/auth/src/server/cookieDomain.ts). Both must agree for a given host, or the session cookie
 * and the visitor cookie end up on different domains and one browser becomes two visitors.
 */
import { normalizeRequestHost } from "./requestHost";

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
 * precisely the `Set-Cookie` the browser discards, and the caller then reads a request that appears
 * to have succeeded. A misconfigured deployment fails loudly on its first cookie instead.
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
