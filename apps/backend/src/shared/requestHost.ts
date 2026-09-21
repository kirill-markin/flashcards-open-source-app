/**
 * Normalizes a `Host` header into a comparable hostname: lower-cased, without a
 * port, without a trailing root dot, and without surrounding whitespace. Returns
 * `null` when there is nothing usable to compare.
 *
 * The value is client-controlled, so callers only ever compare it against
 * configured names and never build a URL from it directly.
 */
export function normalizeRequestHost(value: string | null | undefined): string | null {
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
