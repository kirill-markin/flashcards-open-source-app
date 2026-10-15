import { cognitoFetch, extractTokenResult, getClientId, type TokenResult } from "../cognito/cognitoAuth.js";
import {
  issueNativeProofGrant,
  nativeProofLifetimeMs,
  nativeProofTokenPattern,
  type NativeProofPrincipal,
} from "./nativeProofGrant.js";

export async function initiateNativeProofChallenge(principal: NativeProofPrincipal): Promise<Readonly<{
  session: string; nonce: string; expiresAt: Date;
}>> {
  const clientId = getClientId();
  const challenge = await cognitoFetch("InitiateAuth", {
    AuthFlow: "CUSTOM_AUTH", ClientId: clientId,
    AuthParameters: { USERNAME: principal.cognitoUsername },
  });
  const parameters = challenge.ChallengeParameters as Record<string, unknown> | undefined;
  const nonce = parameters?.nonce;
  const expiresAt = Number(parameters?.expiresAt);
  if (challenge.ChallengeName !== "CUSTOM_CHALLENGE" || typeof challenge.Session !== "string"
    || challenge.Session.length < 20
    || typeof nonce !== "string" || !nativeProofTokenPattern.test(nonce)
    || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()
    || expiresAt > Date.now() + nativeProofLifetimeMs) {
    throw new Error("Cognito returned an invalid native proof challenge");
  }
  return { session: challenge.Session, nonce, expiresAt: new Date(expiresAt) };
}

export async function exchangeVerifiedPrincipalForTokens(principal: NativeProofPrincipal): Promise<TokenResult> {
  const clientId = getClientId();
  const challenge = await initiateNativeProofChallenge(principal);
  const proof = await issueNativeProofGrant(principal, clientId, challenge.nonce, challenge.expiresAt);
  const result = await cognitoFetch("RespondToAuthChallenge", {
    ClientId: clientId, ChallengeName: "CUSTOM_CHALLENGE", Session: challenge.session,
    ChallengeResponses: { USERNAME: principal.cognitoUsername, ANSWER: proof },
  });
  return extractTokenResult(result, "Cognito native proof bridge");
}
