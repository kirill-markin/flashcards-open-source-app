import { createHash, timingSafeEqual } from "node:crypto";
import { JwtVerifier } from "aws-jwt-verify";
import { JwtInvalidClaimError, JwtInvalidSignatureError, JwtParseError, KidNotFoundInJwksError, JwtWithoutValidKidError, JwtInvalidSignatureAlgorithmError, ParameterValidationError } from "aws-jwt-verify/error";
import { SimpleFetcher, type Fetcher } from "aws-jwt-verify/https";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import { logWarning } from "../logger.js";
import type { IdentityProvider } from "./identityStore.js";

export type SocialClient = "web" | "android" | "ios" | "ios-development" | "macos" | "macos-development";
export type ProviderEmail = Readonly<{
  address: string;
  authority: "provider" | "otp_required";
  privateRelay: boolean;
}>;
export type VerifiedProviderIdentity = Readonly<{
  provider: IdentityProvider;
  subject: string;
  clientId: string;
  email: ProviderEmail | null;
}>;
export type SocialProofErrorCode = "PROVIDER_UNAVAILABLE" | "PROVIDER_CONFIGURATION_INVALID" | "PROVIDER_PROOF_INVALID" | "PROVIDER_TEMPORARILY_UNAVAILABLE" | "PROVIDER_CREDENTIAL_INVALID";

export class SocialProofError extends Error {
  constructor(readonly code: SocialProofErrorCode) {
    super(code);
    this.name = "SocialProofError";
  }
}

/** Prevent upstream JWT errors from quoting claim values, tokens or mailbox addresses. */
export function rejectProviderProof(error: unknown): never {
  const invalid = error instanceof SocialProofError || error instanceof JwtInvalidClaimError
    || error instanceof JwtInvalidSignatureError || error instanceof JwtParseError
    || error instanceof KidNotFoundInJwksError || error instanceof JwtWithoutValidKidError
    || error instanceof JwtInvalidSignatureAlgorithmError || error instanceof ParameterValidationError;
  throw error instanceof SocialProofError ? error : new SocialProofError(
    invalid ? "PROVIDER_PROOF_INVALID" : "PROVIDER_TEMPORARILY_UNAVAILABLE",
  );
}

class ProviderJwksFetcher implements Fetcher {
  private readonly fetcher = new SimpleFetcher({ defaultRequestOptions: { responseTimeout: 3_000 } });
  async fetch(...args: Parameters<Fetcher["fetch"]>): ReturnType<Fetcher["fetch"]> {
    try {
      return await this.fetcher.fetch(...args);
    } catch {
      logWarning({ domain: "auth", action: "error", code: "PROVIDER_JWKS_FETCH_FAILED" });
      throw new SocialProofError("PROVIDER_TEMPORARILY_UNAVAILABLE");
    }
  }
}

// Shared cache coalesces refreshes and retains the library's ten-second unknown-kid penalty box.
export const providerJwksCache = new SimpleJwksCache({ fetcher: new ProviderJwksFetcher() });

export function createProviderVerifier(issuer: string, audience: string, jwksUri: string) {
  return JwtVerifier.create({ issuer, audience, jwksUri, graceSeconds: 0,
    customJwtCheck: ({ header }) => {
      if (header.alg !== "RS256") throw new SocialProofError("PROVIDER_PROOF_INVALID");
    },
  }, { jwksCache: providerJwksCache });
}

export function validateProofInput(token: string, rawNonce: string): void {
  if (token.length > 16_384 || token.split(".").length !== 3 || !/^[A-Za-z0-9_-]{32,200}$/.test(rawNonce)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
}

export function appleRequestNonce(rawNonce: string): string {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(rawNonce)) throw new SocialProofError("PROVIDER_PROOF_INVALID");
  return createHash("sha256").update(rawNonce).digest("hex");
}

export function validateProviderClaims(payload: JwtPayload, expectedNonce: string, audience: string): string {
  const now = Math.floor(Date.now() / 1_000);
  const nonce = typeof payload.nonce === "string" ? Buffer.from(payload.nonce) : Buffer.alloc(0);
  const expected = Buffer.from(expectedNonce);
  if (nonce.length !== expected.length || !timingSafeEqual(nonce, expected)
    || payload.aud !== audience || typeof payload.sub !== "string" || !/^[A-Za-z0-9._-]{1,255}$/.test(payload.sub)
    || !Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now
    || !Number.isSafeInteger(payload.iat) || (payload.iat as number) > now + 30
    || (payload.iat as number) < now - 600 || (payload.exp as number) <= (payload.iat as number)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  return payload.sub;
}

export function readProviderEmail(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  return value.toLowerCase();
}

export function readProviderBoolean(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === undefined || value === false || value === "false") return false;
  throw new SocialProofError("PROVIDER_PROOF_INVALID");
}

export function parseProviderObject(json: string, failure: SocialProofErrorCode): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Parsing errors may quote secrets. */ }
  throw new SocialProofError(failure);
}

// A lost authorization-code response may consume the code: a failed retry requires a new attempt.
export async function postProviderForm(provider: IdentityProvider, endpoint: string, form: URLSearchParams): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SocialProofError(response.status === 429 || response.status >= 500
          ? "PROVIDER_TEMPORARILY_UNAVAILABLE" : "PROVIDER_PROOF_INVALID");
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 65_536) throw new SocialProofError("PROVIDER_PROOF_INVALID");
      return text;
    } catch (error) {
      const safe = error instanceof SocialProofError ? error : new SocialProofError("PROVIDER_TEMPORARILY_UNAVAILABLE");
      logWarning({ domain: "auth", action: "error", code: safe.code, reasonCategory: `${provider}_request_attempt_${attempt}` });
      if (safe.code !== "PROVIDER_TEMPORARILY_UNAVAILABLE" || attempt === 2) throw safe;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new SocialProofError("PROVIDER_TEMPORARILY_UNAVAILABLE");
}

export const socialAuthOrigins: ReadonlyArray<string> = ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"];

export function assertProviderCallback(provider: "apple" | "google", redirectUri: string): void {
  if (!socialAuthOrigins.some((origin) => redirectUri === `${origin}/api/social/${provider}/callback`)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
}

