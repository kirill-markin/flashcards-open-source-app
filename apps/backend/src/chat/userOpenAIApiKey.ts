/**
 * The person's own OpenAI API key, accepted on `POST /chat` and `POST /chat/transcriptions` only and never
 * stored: not in Postgres, logs, Sentry, or Langfuse. It reaches the chat worker only inside the asynchronous
 * invoke payload (`./worker/invoke.ts`).
 */
import { inspect } from "node:util";
import { HttpError } from "../shared/errors";

export const USER_OPENAI_API_KEY_HEADER = "x-openai-api-key";
/** The worker invoke payload field that carries the raw key; `observability/sentry/redaction.ts` drops it. */
export const USER_OPENAI_API_KEY_WORKER_PAYLOAD_FIELD = "userOpenAIApiKey";

const maximumUserOpenAIApiKeyLength = 512;
const redactedUserOpenAIApiKey = "[redacted]";

/**
 * Redacts the key by type: every serialization answers `[redacted]`, so the value cannot leak through a log
 * record, an error context, or a JSON body that happens to carry it.
 */
export class UserOpenAIApiKey {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Called only where an OpenAI client is built and where the worker invoke payload is serialized. */
  revealRawValue(): string {
    return this.#value;
  }

  toJSON(): string {
    return redactedUserOpenAIApiKey;
  }

  toString(): string {
    return redactedUserOpenAIApiKey;
  }

  [inspect.custom](): string {
    return redactedUserOpenAIApiKey;
  }
}

/**
 * Reads the optional key header. The prefix is not checked and OpenAI is not asked: a key OpenAI rejects
 * fails the call it was used for, with OpenAI's own message.
 */
export function readUserOpenAIApiKeyHeader(request: Request): UserOpenAIApiKey | null {
  const headerValue = request.headers.get(USER_OPENAI_API_KEY_HEADER);
  if (headerValue === null) {
    return null;
  }

  const trimmedValue = headerValue.trim();
  if (trimmedValue.length === 0 || trimmedValue.length > maximumUserOpenAIApiKeyLength) {
    throw new HttpError(
      400,
      `The ${USER_OPENAI_API_KEY_HEADER} header must be a non-empty OpenAI API key of at most ${maximumUserOpenAIApiKeyLength} characters.`,
      "OPENAI_API_KEY_INVALID",
    );
  }

  return new UserOpenAIApiKey(trimmedValue);
}

/** Rewraps the raw key the worker invoke payload carries, because JSON transport turned it back into a string. */
export function wrapWorkerPayloadUserOpenAIApiKey(value: string | null | undefined): UserOpenAIApiKey | null {
  return value === undefined || value === null ? null : new UserOpenAIApiKey(value);
}
