import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { checkDemoAccountMethodRefusals } from "./accountMethodsGate.js";
import { query } from "../db.js";
import { getDemoEmailAccessConfig, getDemoEmailPassword } from "../server/demoEmailAccess.js";
import { cognitoFetch, extractTokenResult, getClientId, refreshTokens, revokeToken, signInWithPassword } from "../server/cognito/cognitoAuth.js";
import { getCognitoErrorType } from "../server/cognito/cognitoErrors.js";
import { exchangeVerifiedPrincipalForTokens, initiateNativeProofChallenge } from "../server/social/nativeProofBridge.js";
import { issueNativeProofGrant, redeemNativeProofGrant, type NativeProofPrincipal } from "../server/social/nativeProofGrant.js";

type Challenge = Awaited<ReturnType<typeof initiateNativeProofChallenge>>;

async function answer(principal: NativeProofPrincipal, challenge: Challenge, proof: string): Promise<Record<string, unknown>> {
  return cognitoFetch("RespondToAuthChallenge", {
    ClientId: getClientId(), ChallengeName: "CUSTOM_CHALLENGE", Session: challenge.session,
    ChallengeResponses: { USERNAME: principal.cognitoUsername, ANSWER: proof },
    ClientMetadata: { verified: "true", cognitoSubject: principal.cognitoSubject, proof },
  });
}

async function expectRefused(operation: Promise<Record<string, unknown>>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (getCognitoErrorType(error) === "NotAuthorizedException") return;
    throw error;
  }
  throw new Error("Cognito accepted an invalid native proof challenge");
}

/** Private IAM-only runner. The event cannot select an account, SQL, proof, or returned tokens. */
export async function handler(): Promise<Readonly<{ passed: true; checks: ReadonlyArray<string> }>> {
  const email = getDemoEmailAccessConfig().emailAllowlist.values().next().value;
  if (email === undefined) throw new Error("Native proof gate requires a configured review account");
  const password = await getDemoEmailPassword(email);
  if (password === null) throw new Error("Native proof gate requires the configured review password");
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (userPoolId === undefined || userPoolId === "") throw new Error("COGNITO_USER_POOL_ID is required");
  const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: "id", clientId: getClientId() });
  const refreshCredentials: Array<string> = [];
  let primaryError: unknown;
  try {
    const passwordTokens = await signInWithPassword(email, password);
    refreshCredentials.push(passwordTokens.refreshToken);
    const claims = await verifier.verify(passwordTokens.idToken);
    const username = claims["cognito:username"];
    if (typeof username !== "string" || username === "") throw new Error("Review JWT omitted its Cognito username");
    const principal = { cognitoSubject: claims.sub, cognitoUsername: username };
    await query("SELECT auth.register_cognito_principal($1, $2)", [principal.cognitoSubject, principal.cognitoUsername]);

    await checkDemoAccountMethodRefusals(passwordTokens.idToken);

    const forged = await initiateNativeProofChallenge(principal);
    await expectRefused(answer(principal, forged, randomBytes(32).toString("hex")));

    const wrongClient = await initiateNativeProofChallenge(principal);
    const wrongClientProof = await issueNativeProofGrant(principal, `${getClientId()}-wrong`, wrongClient.nonce, wrongClient.expiresAt);
    await expectRefused(answer(principal, wrongClient, wrongClientProof));

    const wrongNonce = await initiateNativeProofChallenge(principal);
    const wrongNonceProof = await issueNativeProofGrant(principal, getClientId(), randomBytes(32).toString("hex"), wrongNonce.expiresAt);
    await expectRefused(answer(principal, wrongNonce, wrongNonceProof));

    const expired = await initiateNativeProofChallenge(principal);
    const expiredProof = await issueNativeProofGrant(principal, getClientId(), expired.nonce, new Date(Date.now() + 1_000));
    await setTimeout(1_200);
    await expectRefused(answer(principal, expired, expiredProof));

    const atomic = await initiateNativeProofChallenge(principal);
    const atomicProof = await issueNativeProofGrant(principal, getClientId(), atomic.nonce, atomic.expiresAt);
    assert.equal(await redeemNativeProofGrant(
      { cognitoSubject: "wrong-principal", cognitoUsername: username }, getClientId(), atomic.nonce, atomicProof,
    ), false);
    assert.equal(await redeemNativeProofGrant(
      { cognitoSubject: principal.cognitoSubject, cognitoUsername: "wrong-username" }, getClientId(), atomic.nonce, atomicProof,
    ), false);
    const raced = await Promise.all([
      redeemNativeProofGrant(principal, getClientId(), atomic.nonce, atomicProof),
      redeemNativeProofGrant(principal, getClientId(), atomic.nonce, atomicProof),
    ]);
    assert.deepEqual(raced.sort(), [false, true]);
    await expectRefused(answer(principal, atomic, atomicProof));

    const success = await initiateNativeProofChallenge(principal);
    const successProof = await issueNativeProofGrant(principal, getClientId(), success.nonce, success.expiresAt);
    const tokens = extractTokenResult(await answer(principal, success, successProof), "Native proof cloud gate");
    refreshCredentials.push(tokens.refreshToken);
    const originalClaims = await verifier.verify(tokens.idToken);
    assert.equal(originalClaims.sub, principal.cognitoSubject);
    assert.ok(Number.isSafeInteger(originalClaims.auth_time));
    assert.ok(originalClaims.auth_time <= originalClaims.iat);
    await expectRefused(answer(principal, success, successProof));
    const replay = await initiateNativeProofChallenge(principal);
    await expectRefused(answer(principal, replay, successProof));
    await setTimeout(1_100);
    const refreshed = await refreshTokens(tokens.refreshToken);
    if (refreshed.refreshToken !== null) refreshCredentials.push(refreshed.refreshToken);
    const refreshedClaims = await verifier.verify(refreshed.idToken);
    assert.equal(refreshedClaims.sub, principal.cognitoSubject);
    assert.equal(refreshedClaims.auth_time, originalClaims.auth_time);
    assert.ok(refreshedClaims.iat > originalClaims.iat);

    const bridgeTokens = await exchangeVerifiedPrincipalForTokens(principal);
    refreshCredentials.push(bridgeTokens.refreshToken);
    assert.equal((await verifier.verify(bridgeTokens.idToken)).sub, principal.cognitoSubject);
    return { passed: true, checks: [
      "USER_AUTH/PASSWORD", "CUSTOM_AUTH", "forged-metadata", "wrong-client", "wrong-nonce",
      "expired-grant", "SQL-wrong-principal/username", "atomic-redemption", "session-and-grant-replay",
      "GetTokensFromRefreshToken", "internal-bridge", "signed-original-auth-time", "account-method-demo-transport-refusals",
    ] };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled(refreshCredentials.map(revokeToken));
    const errors = cleanup.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length !== 0) {
      throw new AggregateError(primaryError === undefined ? errors : [primaryError, ...errors], "Native proof gate refresh credential revocation failed");
    }
  }
}
