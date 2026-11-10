import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { loadPlainTextSecret } from "../../aws/secrets";
import type { DatabaseExecutor } from "../../database";
import { unsafeQuery } from "../../database/unsafe";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import {
  evaluateGuestChallengeFlags,
  loadGuestChallengeRequestFacts,
  type GuestChallengeFlag,
  type GuestChallengeRequestFacts,
} from "./challengeRisk";
import { insertGuestBrowserCheckInExecutor } from "./checkRecords";
import { TurnstileSiteverifyClient } from "./turnstile";

// Must match the action the web client renders the widget with.
const turnstileAction = "guest_session";
const turnstileTokenMaximumLength = 2048;

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
type ChallengeFailure = Readonly<{
  reason: ChallengeFailureReason;
  turnstileErrorCodes: ReadonlyArray<string>;
  turnstileAction: string | null;
  turnstileHostname: string | null;
}>;

/** A request the check lets through; the caller records it with the guest it creates. */
export type GuestBrowserChallengeDecision = Readonly<{
  outcome: "allowed" | "passed" | "bypassed";
  flags: ReadonlyArray<GuestChallengeFlag>;
  facts: GuestChallengeRequestFacts;
}>;

const guestChallengeSecretSchema = z.object({
  siteKey: z.string().trim().min(1),
  secretKey: z.string().trim().min(1),
  bypassToken: z.string().trim().min(1),
});

type LoadedGuestChallengeSecret = Readonly<{
  secretName: string;
  siteKey: string;
  turnstileClient: TurnstileSiteverifyClient;
  bypassTokenDigest: Buffer;
}>;

let cachedGuestChallengeSecret: LoadedGuestChallengeSecret | null = null;

/** The Secrets Manager name of the challenge configuration; null keeps the challenge off. */
export function readGuestBrowserChallengeSecretName(): string | null {
  const secretName = process.env.GUEST_CHALLENGE_SECRET?.trim() ?? "";
  return secretName === "" ? null : secretName;
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

async function loadGuestChallengeSecret(secretName: string): Promise<LoadedGuestChallengeSecret> {
  if (cachedGuestChallengeSecret !== null && cachedGuestChallengeSecret.secretName === secretName) {
    return cachedGuestChallengeSecret;
  }
  const secretString = await loadPlainTextSecret(secretName);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(secretString);
  } catch {
    // The SyntaxError message quotes the parsed input, i.e. the secret, so neither it nor `cause` is attached.
    throw new Error(`Secret ${secretName} (GUEST_CHALLENGE_SECRET) is not valid JSON; store {"siteKey","secretKey","bypassToken"}.`);
  }
  const parsed = guestChallengeSecretSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `Secret ${secretName} (GUEST_CHALLENGE_SECRET) must hold non-empty string fields siteKey, secretKey and bypassToken: `
      + parsed.error.message,
    );
  }
  cachedGuestChallengeSecret = {
    secretName,
    siteKey: parsed.data.siteKey,
    turnstileClient: new TurnstileSiteverifyClient(parsed.data.secretKey),
    bypassTokenDigest: digestToken(parsed.data.bypassToken),
  };
  return cachedGuestChallengeSecret;
}

function isValidBypassToken(secret: LoadedGuestChallengeSecret, token: string): boolean {
  // Equal-length digests keep the comparison constant-time whatever the caller sent.
  return timingSafeEqual(digestToken(token), secret.bypassTokenDigest);
}

function logChallengeOutcome(
  outcome: ChallengeOutcome,
  flags: ReadonlyArray<GuestChallengeFlag>,
  facts: GuestChallengeRequestFacts,
  scope: BackendObservationScope,
  failure: ChallengeFailure | null,
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

const unsafeCheckRecordExecutor: DatabaseExecutor = { query: unsafeQuery };

// A refused request creates no guest, so its row is written on its own before the refusal is thrown.
async function recordRefusedChallenge(
  outcome: "required" | "failed",
  flags: ReadonlyArray<GuestChallengeFlag>,
  facts: GuestChallengeRequestFacts,
  failure: ChallengeFailure | null,
): Promise<void> {
  await insertGuestBrowserCheckInExecutor(unsafeCheckRecordExecutor, {
    outcome,
    flags,
    facts,
    failureReason: failure?.reason ?? null,
    turnstileErrorCodes: failure?.turnstileErrorCodes ?? null,
    guestUserId: null,
  });
}

function createChallengeFailedError(message: string): HttpError {
  return new HttpError(403, message, "GUEST_BROWSER_CHALLENGE_FAILED");
}

/** Resolves when a new guest may be created; throws the 403 the web client answers with Turnstile. */
export async function enforceGuestBrowserChallenge(
  secretName: string,
  request: GuestBrowserChallengeRequest,
): Promise<GuestBrowserChallengeDecision> {
  const facts = await loadGuestChallengeRequestFacts(request.userAgent, request.secChUa, request.scope);
  const flags = evaluateGuestChallengeFlags(facts);

  if (request.automationBypassToken !== null) {
    if (!isValidBypassToken(await loadGuestChallengeSecret(secretName), request.automationBypassToken)) {
      const failure: ChallengeFailure = {
        reason: "bypass_token_invalid", turnstileErrorCodes: [], turnstileAction: null, turnstileHostname: null,
      };
      logChallengeOutcome("failed", flags, facts, request.scope, failure);
      await recordRefusedChallenge("failed", flags, facts, failure);
      throw createChallengeFailedError("automationBypassToken is not valid. Send the configured bypass token or omit it.");
    }
    if (flags.length > 0) {
      logChallengeOutcome("bypassed", flags, facts, request.scope, null);
    }
    return { outcome: "bypassed", flags, facts };
  }
  if (flags.length === 0) {
    return { outcome: "allowed", flags, facts };
  }

  if (request.turnstileToken === null) {
    logChallengeOutcome("required", flags, facts, request.scope, null);
    await recordRefusedChallenge("required", flags, facts, null);
    throw new HttpError(
      403,
      "Complete the browser check before a guest account is created.",
      "GUEST_BROWSER_CHALLENGE_REQUIRED",
      { turnstileSiteKey: (await loadGuestChallengeSecret(secretName)).siteKey },
    );
  }
  if (request.turnstileToken.length > turnstileTokenMaximumLength) {
    throw new HttpError(400, `turnstileToken must be at most ${turnstileTokenMaximumLength} characters.`);
  }

  const { turnstileClient } = await loadGuestChallengeSecret(secretName);
  const result = await turnstileClient.verify(request.turnstileToken, request.remoteIp, request.scope);
  const failureReason: ChallengeFailureReason | null = !result.success
    ? "turnstile_rejected"
    : result.action !== turnstileAction
      ? "action_mismatch"
      : result.hostname !== request.expectedHostname
        ? "hostname_mismatch"
        : null;
  if (failureReason !== null) {
    const failure: ChallengeFailure = {
      reason: failureReason,
      turnstileErrorCodes: result.errorCodes,
      turnstileAction: result.action,
      turnstileHostname: result.hostname,
    };
    logChallengeOutcome("failed", flags, facts, request.scope, failure);
    await recordRefusedChallenge("failed", flags, facts, failure);
    throw createChallengeFailedError("The browser check did not pass. Complete a new check and try again.");
  }
  logChallengeOutcome("passed", flags, facts, request.scope, null);
  return { outcome: "passed", flags, facts };
}
