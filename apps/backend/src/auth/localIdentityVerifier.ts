import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { JwtVerifier } from "aws-jwt-verify";
import { JwtInvalidClaimError } from "aws-jwt-verify/error";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import { unsafeQuery } from "../database/unsafe";
import { readStandaloneSecretFile } from "../deployment/standalone";
import { HttpError } from "../shared/errors";

/**
 * AUTH_MODE=local: verifies the standalone auth service's ID tokens
 * (apps/auth/src/server/local/localTokens.ts) against the public key at LOCAL_AUTH_PUBLIC_KEY_FILE,
 * issuer PUBLIC_AUTH_BASE_URL and the fixed audience. The token's `sid` session must still be live,
 * so logout ends an ID token before its `exp`; the backend reads no auth.local_* table itself.
 */
const localIdTokenAudience = "nibomo-standalone";
const minimumModulusBits = 2048;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A claim failure, so the auth boundary answers it as a terminal 401 like other invalid tokens. */
class LocalIdTokenClaimError extends JwtInvalidClaimError {}

let verifier: ReturnType<typeof JwtVerifier.create> | undefined;

function readPublicKey(): KeyObject {
  const variableName = "LOCAL_AUTH_PUBLIC_KEY_FILE";
  const contents = readStandaloneSecretFile(variableName);
  const invalid = (reason: string): Error => new Error(
    `${variableName} names ${process.env[variableName]}, which must hold the auth service's RSA public key PEM: ${reason}`,
  );
  // The backend only verifies, so it must never be handed the signing key.
  if (contents.includes("PRIVATE KEY")) throw invalid("it holds a private key");
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(contents);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  if (publicKey.asymmetricKeyType !== "rsa") throw invalid(`got a ${publicKey.asymmetricKeyType} key`);
  const modulusBits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (modulusBits < minimumModulusBits) throw invalid(`got ${modulusBits} bits, need at least ${minimumModulusBits}`);
  return publicKey;
}

function getVerifier(): ReturnType<typeof JwtVerifier.create> {
  if (verifier !== undefined) return verifier;
  const issuer = process.env.PUBLIC_AUTH_BASE_URL ?? "";
  if (issuer === "") throw new Error("PUBLIC_AUTH_BASE_URL is required when AUTH_MODE=local; it is the ID token issuer.");
  const jwk = readPublicKey().export({ format: "jwk" });
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") throw new Error("LOCAL_AUTH_PUBLIC_KEY_FILE did not export as an RSA JWK");
  // RFC 7638 thumbprint, the kid the auth service derives from the matching private key.
  const kid = createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
  const created = JwtVerifier.create({
    issuer: new URL(issuer).origin,
    audience: localIdTokenAudience,
    customJwtCheck: ({ payload }) => {
      if (payload.token_use !== "id") throw new LocalIdTokenClaimError("Local token is not an ID token", payload.token_use, "id");
      if (typeof payload.sid !== "string" || !uuidPattern.test(payload.sid)) {
        throw new LocalIdTokenClaimError("Local ID token has no session id", payload.sid, "uuid");
      }
    },
  });
  // Only verifySync is used, so the configured key is the only key and nothing is ever fetched.
  created.cacheJwks({ keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid, use: "sig", alg: "RS256" }] });
  verifier = created;
  return verifier;
}

/** Fails startup on a missing or wrong key or issuer instead of on the first request. */
export function assertLocalIdTokenVerifierConfigured(): void {
  getVerifier();
}

export async function verifyLocalIdToken(token: string): Promise<JwtPayload & Readonly<{ sub: string }>> {
  const payload = getVerifier().verifySync(token);
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new LocalIdTokenClaimError("Local ID token has no subject", payload.sub, "subject");
  }
  const result = await unsafeQuery<Readonly<{ status: string }>>(
    "SELECT auth.local_session_status($1, $2) AS status", [payload.sid as string, payload.sub],
  );
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("Local session validation returned no result");
  // 'deleted' (a tombstoned subject) passes only to the principal check every caller runs next.
  if (status !== "valid" && status !== "deleted") throw new HttpError(401, "This session was revoked. Sign in again.", "SESSION_REVOKED");
  return { ...payload, sub: payload.sub };
}

/** Account deletion's identity step on AUTH_MODE=local, in place of deleting the Cognito user. */
export async function deleteLocalIdentity(subject: string): Promise<void> {
  await unsafeQuery("SELECT auth.delete_local_identity($1)", [subject]);
}
