import { randomBytes } from "node:crypto";
import {
  nativeProofChallengeMetadata,
  nativeProofLifetimeMs,
  redeemNativeProofGrant,
} from "../server/social/nativeProofGrant.js";

type ChallengeResult = Readonly<{
  challengeName: string;
  challengeResult: boolean;
  challengeMetadata?: string;
}>;

type ChallengeEvent = Readonly<{
  triggerSource: string;
  userName: string;
  callerContext: Readonly<{ clientId: string }>;
  request: Readonly<{
    userAttributes: Readonly<Record<string, string>>;
    userNotFound?: boolean;
    session?: ReadonlyArray<ChallengeResult>;
    challengeName?: string;
    privateChallengeParameters?: Readonly<Record<string, string>>;
    challengeAnswer?: string;
  }>;
}>;

/** Cognito owns history and private parameters; ClientMetadata is never authorization. */
export async function handler(event: ChallengeEvent): Promise<ChallengeEvent & { response: object }> {
  if (event.triggerSource === "DefineAuthChallenge_Authentication") {
    const session = event.request.session;
    if (session === undefined) throw new Error("Cognito Define challenge omitted session history");
    const passed = event.request.userNotFound !== true && session.length === 1
      && session[0].challengeName === "CUSTOM_CHALLENGE"
      && session[0].challengeMetadata === nativeProofChallengeMetadata
      && session[0].challengeResult === true;
    return { ...event, response: {
      issueTokens: passed,
      failAuthentication: !passed && (session.length !== 0 || event.request.userNotFound === true),
      ...(session.length === 0 ? { challengeName: "CUSTOM_CHALLENGE" } : {}),
    } };
  }
  if (event.triggerSource === "CreateAuthChallenge_Authentication") {
    if (event.request.challengeName !== "CUSTOM_CHALLENGE" || event.request.session?.length !== 0) {
      throw new Error("Unexpected Cognito native proof challenge sequence");
    }
    const nonce = randomBytes(32).toString("hex");
    const parameters = { nonce, expiresAt: String(Date.now() + nativeProofLifetimeMs) };
    return { ...event, response: {
      publicChallengeParameters: parameters,
      privateChallengeParameters: parameters,
      challengeMetadata: nativeProofChallengeMetadata,
    } };
  }
  if (event.triggerSource === "VerifyAuthChallengeResponse_Authentication") {
    const parameters = event.request.privateChallengeParameters;
    const expiry = Number(parameters?.expiresAt);
    const subject = event.request.userAttributes.sub;
    const proof = event.request.challengeAnswer;
    let answerCorrect = false;
    if (event.request.userNotFound !== true && typeof subject === "string" && subject !== ""
      && parameters !== undefined && Number.isSafeInteger(expiry)
      && expiry > Date.now() && expiry <= Date.now() + nativeProofLifetimeMs
      && typeof proof === "string") {
      answerCorrect = await redeemNativeProofGrant(
        { cognitoSubject: subject, cognitoUsername: event.userName },
        event.callerContext.clientId, parameters.nonce, proof,
      );
    }
    return { ...event, response: { answerCorrect } };
  }
  throw new Error(`Unsupported Cognito native proof trigger: ${event.triggerSource}`);
}
