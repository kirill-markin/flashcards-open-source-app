import { createHash, timingSafeEqual } from "node:crypto";

const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Verifies a PKCE `code_verifier` against a stored S256 `code_challenge`
 * (RFC 7636). The challenge is the base64url-encoded SHA-256 of the verifier.
 * Only S256 is supported; `plain` is intentionally rejected. The comparison is
 * constant-time to avoid leaking how much of the challenge matched.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!CODE_VERIFIER_RE.test(codeVerifier)) {
    return false;
  }

  const computedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const computedBuffer = Buffer.from(computedChallenge);
  const storedBuffer = Buffer.from(codeChallenge);
  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(computedBuffer, storedBuffer);
}
