const fixedLocalPublicOrigin = "http://localhost:3000";

function isLocalOrLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    normalizedHostname === "localhost"
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname === "0.0.0.0"
    || normalizedHostname === "[::]"
    || normalizedHostname === "[::1]"
    || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u.test(normalizedHostname)
  ) {
    return true;
  }

  const ipv4Match = /^(\d{1,3})\./u.exec(normalizedHostname);
  return ipv4Match !== null && Number(ipv4Match[1]) === 127;
}

function assertConfiguredLocalOriginPolicy(
  url: URL,
  rawValue: string,
  fieldName: string,
): void {
  if (isLocalOrLoopbackHostname(url.hostname) && rawValue !== fixedLocalPublicOrigin) {
    throw new Error(
      `${fieldName} local or loopback origin must be exactly ${fixedLocalPublicOrigin}`,
    );
  }
}

export function parsePublicOrigin(value: string, fieldName: string): string {
  if (
    value.trim() !== value
    || /[\\\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(
      `${fieldName} must be an absolute HTTP or HTTPS origin without control characters or backslashes, surrounding whitespace, or non-canonical representation`,
    );
  }

  if (/^https?:\/\/[^/?#]+$/iu.test(value) === false) {
    throw new Error(
      `${fieldName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  const authorityStart = value.indexOf("://") + 3;
  const rawAuthority = value.slice(authorityStart);
  if (rawAuthority.includes("@")) {
    throw new Error(
      `${fieldName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be an absolute HTTP or HTTPS origin in canonical form`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.hostname.includes("*")
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(
      `${fieldName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  assertConfiguredLocalOriginPolicy(url, value, fieldName);

  if (value !== url.origin) {
    throw new Error(
      `${fieldName} must be an absolute HTTP or HTTPS origin that exactly matches its canonical serialized form`,
    );
  }

  return url.origin;
}
