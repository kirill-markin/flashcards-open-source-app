function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toUuidFromHexDigest(hexDigest: string): string {
  const baseHex = hexDigest.slice(0, 32).split("");
  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

export function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const exactBytes: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  return exactBytes.buffer;
}

function requireSha256Digest(): SubtleCrypto {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) {
    throw new Error("Media SHA-256 digest failed: Web Crypto SHA-256 digest is unavailable");
  }

  return cryptoApi.subtle;
}

export async function calculateSha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await requireSha256Digest().digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function buildClientWorkspaceReplicaId(workspaceId: string, installationId: string): Promise<string> {
  const seedBytes = new TextEncoder().encode(`${workspaceId}:${installationId}`);
  return toUuidFromHexDigest(await calculateSha256Hex(toExactArrayBuffer(seedBytes)));
}
