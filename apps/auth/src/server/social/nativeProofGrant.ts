import { createHash, randomBytes } from "node:crypto";
import { query } from "../../db.js";

export const nativeProofChallengeMetadata = "native-proof-v1";
export const nativeProofLifetimeMs = 120_000;
export const nativeProofTokenPattern = /^[0-9a-f]{64}$/;

export type NativeProofPrincipal = Readonly<{
  cognitoSubject: string;
  cognitoUsername: string;
}>;

export function hashNativeProof(proof: string): string {
  return createHash("sha256").update(proof).digest("hex");
}

/** Internal capability: call only after fresh provider verification and principal registration. */
export async function issueNativeProofGrant(
  principal: NativeProofPrincipal,
  clientId: string,
  nonce: string,
  expiresAt: Date,
): Promise<string> {
  const proof = randomBytes(32).toString("hex");
  await query("SELECT auth.issue_native_proof_grant($1, $2, $3, $4, $5, $6)", [
    principal.cognitoSubject, principal.cognitoUsername, clientId, nonce, hashNativeProof(proof), expiresAt,
  ]);
  return proof;
}

export async function redeemNativeProofGrant(
  principal: NativeProofPrincipal,
  clientId: string,
  nonce: string,
  proof: string,
): Promise<boolean> {
  if (!nativeProofTokenPattern.test(nonce) || !nativeProofTokenPattern.test(proof)) return false;
  const result = await query<Readonly<{ redeemed: boolean }>>(
    "SELECT auth.redeem_native_proof_grant($1, $2, $3, $4, $5) AS redeemed",
    [principal.cognitoSubject, principal.cognitoUsername, clientId, nonce, hashNativeProof(proof)],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Native proof redemption returned no result");
  return row.redeemed;
}
