import { sign } from "node:crypto";
import { JwtVerifier } from "aws-jwt-verify";
import { JwtInvalidClaimError } from "aws-jwt-verify/error";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import { query } from "../../db.js";
import { PrincipalSessionError } from "../social/principalSessions.js";
import { getLocalIdentityConfig, localIdTokenTtlSeconds } from "./localConfig.js";

/**
 * RS256 ID tokens of AUTH_IDENTITY_PROVIDER=local, shaped like the Cognito ID token claims the
 * backend reads. A valid signature is not enough: the `sid` session must still be live.
 */
export type LocalIdTokenClaims = Readonly<{ subject: string; email: string; sessionId: string; authTime: number }>;

class LocalIdTokenClaimError extends JwtInvalidClaimError {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let verifier: ReturnType<typeof JwtVerifier.create> | undefined;

export function signLocalIdToken(claims: LocalIdTokenClaims, nowSeconds: number): string {
  const config = getLocalIdentityConfig();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: config.signingKey.publicJwk.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: config.issuer,
    aud: config.audience,
    sub: claims.subject,
    email: claims.email,
    email_verified: true,
    token_use: "id",
    sid: claims.sessionId,
    auth_time: claims.authTime,
    iat: nowSeconds,
    exp: nowSeconds + localIdTokenTtlSeconds,
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), config.signingKey.privateKey).toString("base64url")}`;
}

function getVerifier(): ReturnType<typeof JwtVerifier.create> {
  if (verifier !== undefined) return verifier;
  const config = getLocalIdentityConfig();
  const created = JwtVerifier.create({
    issuer: config.issuer,
    audience: config.audience,
    customJwtCheck: ({ payload }) => {
      if (payload.token_use !== "id") throw new LocalIdTokenClaimError("Local token is not an ID token", payload.token_use, "id");
      if (typeof payload.sid !== "string" || !uuidPattern.test(payload.sid)) {
        throw new LocalIdTokenClaimError("Local ID token has no session id", payload.sid, "uuid");
      }
    },
  });
  // Only verifySync is used, so the configured key is the only key and nothing is ever fetched.
  created.cacheJwks({ keys: [config.signingKey.publicJwk] });
  verifier = created;
  return verifier;
}

export async function verifyLocalIdToken(token: string): Promise<JwtPayload & Readonly<{ sub: string; sid: string }>> {
  const payload = getVerifier().verifySync(token);
  if (typeof payload.sub !== "string" || payload.sub === "") throw new LocalIdTokenClaimError("Local ID token has no subject", payload.sub, "subject");
  const sessionId = payload.sid as string;
  const result = await query<Readonly<{ status: string }>>(
    "SELECT auth.local_session_status($1, $2) AS status", [sessionId, payload.sub],
  );
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("Local session validation returned no result");
  // 'deleted' (a tombstoned subject) passes only to the principal check every caller runs next.
  if (status !== "valid" && status !== "deleted") throw new PrincipalSessionError("revoked");
  return { ...payload, sub: payload.sub, sid: sessionId };
}
