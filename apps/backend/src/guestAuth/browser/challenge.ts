import { createHash, timingSafeEqual } from "node:crypto";
import { loadPlainTextSecret } from "../../aws/secrets";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import {
  evaluateGuestChallengeFlags,
  loadGuestChallengeRequestFacts,
  type GuestChallengeFlag,
  type GuestChallengeRequestFacts,
} from "./challengeRisk";
import { TurnstileSiteverifyClient } from "./turnstile";

// Must match the action the web client renders the widget with.
const turnstileAction = "guest_session";
const turnstileTokenMaximumLength = 2048;

export type GuestBrowserChallengeConfig = Readonly<{
  turnstileSiteKey: string;
  turnstileSecretArn: string;
  bypassSecretArn: string;
}>;

export type GuestBrowserChallengeRequest = Readonly<{
  turnstileToken: string | null;
  automationBypassToken: string | null;
  userAgent: string | null;
  secChUa: string | null;
  expectedHostname: string;
  remoteIp: string | null;
  scope: BackendObservationScope;
}>;

type ChallengeOutcome = "required" | "passed" | "failed" | "bypassed";
type ChallengeFailureReason = "turnstile_rejected" | "action_mismatch" | "hostname_mismatch" | "bypass_token_invalid";

let cachedTurnstileClient: Readonly<{ secretArn: string; client: TurnstileSiteverifyClient }> | null = null;
let cachedBypassTokenDigest: Readonly<{ secretArn: string; digest: Buffer }> | null = null;

/** Null keeps the challenge off; a partial configuration is a deployment error. */
export function readGuestBrowserChallengeConfig(): GuestBrowserChallengeConfig | null {
  const turnstileSecretArn = process.env.TURNSTILE_SECRET_ARN?.trim() ?? "";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const bypassSecretArn = process.env.GUEST_CHALLENGE_BYPASS_SECRET_ARN?.trim() ?? "";
  const presentCount = [turnstileSecretArn, turnstileSiteKey, bypassSecretArn].filter((value) => value !== "").length;
  if (presentCount === 0) {
    return null;
  }
  if (presentCount !== 3) {
    throw new Error(
      "The guest browser challenge is partially configured: set TURNSTILE_SECRET_ARN, TURNSTILE_SITE_KEY and "
      + `GUEST_CHALLENGE_BYPASS_SECRET_ARN together or none of them (TURNSTILE_SECRET_ARN set: ${turnstileSecretArn !== ""}, `
      + `TURNSTILE_SITE_KEY set: ${turnstileSiteKey !== ""}, GUEST_CHALLENGE_BYPASS_SECRET_ARN set: ${bypassSecretArn !== ""}).`,
    );
  }
  return { turnstileSiteKey, turnstileSecretArn, bypassSecretArn };
}

async function getTurnstileClient(secretArn: string): Promise<TurnstileSiteverifyClient> {
  if (cachedTurnstileClient === null || cachedTurnstileClient.secretArn !== secretArn) {
    cachedTurnstileClient = { secretArn, client: new TurnstileSiteverifyClient(await loadPlainTextSecret(secretArn)) };
  }
  return cachedTurnstileClient.client;
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

async function isValidBypassToken(secretArn: string, token: string): Promise<boolean> {
  if (cachedBypassTokenDigest === null || cachedBypassTokenDigest.secretArn !== secretArn) {
    cachedBypassTokenDigest = { secretArn, digest: digestToken(await loadPlainTextSecret(secretArn)) };
  }
  // Equal-length digests keep the comparison constant-time whatever the caller sent.
  return timingSafeEqual(digestToken(token), cachedBypassTokenDigest.digest);
}

function logChallengeOutcome(
  outcome: ChallengeOutcome,
  flags: ReadonlyArray<GuestChallengeFlag>,
  facts: GuestChallengeRequestFacts,
  scope: BackendObservationScope,
  failure: Readonly<{
    reason: ChallengeFailureReason;
    turnstileErrorCodes: ReadonlyArray<string>;
    turnstileAction: string | null;
    turnstileHostname: string | null;
  }> | null,
): void {
  writeCloudWatchRecord({
    action: "guest_browser_challenge",
    scope,
    details: {
      outcome,
      flags,
      networkAsn: facts.networkAsn,
      userAgentChromeMajor: facts.userAgentChromeMajor,
      clientHintChromiumMajor: facts.clientHintChromiumMajor,
      currentChromiumMajor: facts.currentChromiumMajor,
      failureReason: failure?.reason ?? null,
      turnstileErrorCodes: failure?.turnstileErrorCodes ?? null,
      turnstileAction: failure?.turnstileAction ?? null,
      turnstileHostname: failure?.turnstileHostname ?? null,
    },
  }, "breadcrumb");
}

function createChallengeFailedError(message: string): HttpError {
  return new HttpError(403, message, "GUEST_BROWSER_CHALLENGE_FAILED");
}

/** Resolves when a new guest may be created; throws the 403 the web client answers with Turnstile. */
export async function enforceGuestBrowserChallenge(
  config: GuestBrowserChallengeConfig,
  request: GuestBrowserChallengeRequest,
): Promise<void> {
  const facts = await loadGuestChallengeRequestFacts(request.userAgent, request.secChUa, request.scope);
  const flags = evaluateGuestChallengeFlags(facts);

  if (request.automationBypassToken !== null) {
    if (!await isValidBypassToken(config.bypassSecretArn, request.automationBypassToken)) {
      logChallengeOutcome("failed", flags, facts, request.scope, {
        reason: "bypass_token_invalid", turnstileErrorCodes: [], turnstileAction: null, turnstileHostname: null,
      });
      throw createChallengeFailedError("automationBypassToken is not valid. Send the configured bypass token or omit it.");
    }
    if (flags.length > 0) {
      logChallengeOutcome("bypassed", flags, facts, request.scope, null);
    }
    return;
  }
  if (flags.length === 0) {
    return;
  }

  if (request.turnstileToken === null) {
    logChallengeOutcome("required", flags, facts, request.scope, null);
    throw new HttpError(
      403,
      "Complete the browser check before a guest account is created.",
      "GUEST_BROWSER_CHALLENGE_REQUIRED",
      { turnstileSiteKey: config.turnstileSiteKey },
    );
  }
  if (request.turnstileToken.length > turnstileTokenMaximumLength) {
    throw new HttpError(400, `turnstileToken must be at most ${turnstileTokenMaximumLength} characters.`);
  }

  const client = await getTurnstileClient(config.turnstileSecretArn);
  const result = await client.verify(request.turnstileToken, request.remoteIp, request.scope);
  const failureReason: ChallengeFailureReason | null = !result.success
    ? "turnstile_rejected"
    : result.action !== turnstileAction
      ? "action_mismatch"
      : result.hostname !== request.expectedHostname
        ? "hostname_mismatch"
        : null;
  if (failureReason !== null) {
    logChallengeOutcome("failed", flags, facts, request.scope, {
      reason: failureReason,
      turnstileErrorCodes: result.errorCodes,
      turnstileAction: result.action,
      turnstileHostname: result.hostname,
    });
    throw createChallengeFailedError("The browser check did not pass. Complete a new check and try again.");
  }
  logChallengeOutcome("passed", flags, facts, request.scope, null);
}
