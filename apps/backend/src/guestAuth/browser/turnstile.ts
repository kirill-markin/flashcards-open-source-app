import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import type { BackendObservationScope } from "../../observability/sentry";

// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const maximumAttempts = 3;
const attemptTimeoutMs = 4_000;
const errorMessageBodyMaximumLength = 500;
// Codes that blame our own request or secret rather than the visitor's token.
const configurationErrorCodes: ReadonlySet<string> = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
]);

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

export type TurnstileSiteverifyResult = Readonly<{
  success: boolean;
  errorCodes: ReadonlyArray<string>;
  action: string | null;
  hostname: string | null;
}>;

export class TurnstileSiteverifyError extends Error {
  readonly httpStatus: number | null;
  readonly responseBody: string | null;

  constructor(message: string, httpStatus: number | null, responseBody: string | null, cause: unknown) {
    // The body goes into the message because request error logging and Sentry record only the message.
    super(
      responseBody === null
        ? message
        : `${message} Response body: ${responseBody.slice(0, errorMessageBodyMaximumLength)}`,
      cause === null ? undefined : { cause },
    );
    this.name = "TurnstileSiteverifyError";
    this.httpStatus = httpStatus;
    this.responseBody = responseBody;
  }
}

type AttemptOutcome =
  | Readonly<{ kind: "result"; result: TurnstileSiteverifyResult }>
  | Readonly<{ kind: "retryable"; error: TurnstileSiteverifyError }>;

export class TurnstileSiteverifyClient {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  /** Resolves with Cloudflare's verdict; throws only when no verdict about the token was obtained. */
  async verify(token: string, remoteIp: string | null, scope: BackendObservationScope): Promise<TurnstileSiteverifyResult> {
    // One key across retries, so a retried attempt is not refused as a duplicate token.
    const idempotencyKey = randomUUID();
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.attempt(token, remoteIp, idempotencyKey);
      if (outcome.kind === "result") {
        return outcome.result;
      }
      if (attempt >= maximumAttempts) {
        throw outcome.error;
      }
      writeCloudWatchRecord({
        action: "turnstile_siteverify_retry",
        scope,
        details: {
          attempt,
          maxAttempts: maximumAttempts,
          httpStatus: outcome.error.httpStatus,
          errorMessage: outcome.error.message,
        },
      }, "warning");
      await setTimeout(attempt * 200);
    }
  }

  private async attempt(token: string, remoteIp: string | null, idempotencyKey: string): Promise<AttemptOutcome> {
    let response: Response;
    let responseBody: string;
    try {
      response = await fetch(siteverifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: this.secretKey,
          response: token,
          ...(remoteIp === null ? {} : { remoteip: remoteIp }),
          idempotency_key: idempotencyKey,
        }),
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      responseBody = await response.text();
    } catch (error) {
      return {
        kind: "retryable",
        error: new TurnstileSiteverifyError(
          `Turnstile siteverify request failed before a response: ${error instanceof Error ? error.message : String(error)}.`,
          null,
          null,
          error,
        ),
      };
    }

    if (response.status === 429 || response.status >= 500) {
      return {
        kind: "retryable",
        error: new TurnstileSiteverifyError(
          `Turnstile siteverify answered HTTP ${response.status}.`, response.status, responseBody, null),
      };
    }
    // Cloudflare can answer a refused request with HTTP 400 and the usual JSON verdict, so the body
    // decides, and a body without that shape fails below with the status attached.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseBody);
    } catch (error) {
      throw new TurnstileSiteverifyError(
        `Turnstile siteverify answered HTTP ${response.status} with a body that is not JSON.`, response.status, responseBody, error);
    }
    const parsed = siteverifyResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new TurnstileSiteverifyError(
        `Turnstile siteverify answered HTTP ${response.status} with an unexpected JSON shape: ${parsed.error.message}`, response.status, responseBody, null);
    }

    const errorCodes = parsed.data["error-codes"] ?? [];
    if (errorCodes.includes("internal-error")) {
      return {
        kind: "retryable",
        error: new TurnstileSiteverifyError(
          "Turnstile siteverify reported internal-error.", response.status, responseBody, null),
      };
    }
    if (errorCodes.some((code) => configurationErrorCodes.has(code))) {
      throw new TurnstileSiteverifyError(
        `Turnstile siteverify refused our request (${errorCodes.join(", ")}); check the Turnstile secret key.`,
        response.status,
        responseBody,
        null,
      );
    }
    return {
      kind: "result",
      result: {
        success: parsed.data.success,
        errorCodes,
        action: parsed.data.action ?? null,
        hostname: parsed.data.hostname ?? null,
      },
    };
  }
}
