export function createBrowserUuidV4(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID().toLowerCase();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Cannot generate a browser UUID: Web Crypto secure randomness is unavailable.");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  // RFC 9562 version 4 and IETF variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
