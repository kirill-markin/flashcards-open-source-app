/**
 * Shared OpenAI client access for the backend-owned chat runtime.
 * The client is memoized per process because the server owns model selection and provider configuration.
 */
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";
import { isLangfuseConfigured } from "../../telemetry/langfuse";
import type { UserOpenAIApiKey } from "../userOpenAIApiKey";

let client: OpenAI | null = null;
let observedClient: OpenAI | null = null;

/**
 * Reads the required OpenAI API key for the backend-owned chat stack.
 */
function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  return apiKey;
}

/**
 * Returns the process-local OpenAI client used by the backend-owned chat runtime.
 */
export function getOpenAIClient(): OpenAI {
  if (client !== null) {
    return client;
  }

  client = new OpenAI({
    apiKey: getApiKey(),
  });
  return client;
}

/**
 * Returns the OpenAI client instance that should be used by observed runtime paths.
 */
export function getObservedOpenAIClient(): OpenAI {
  if (!isLangfuseConfigured(process.env)) {
    return getOpenAIClient();
  }

  if (observedClient !== null) {
    return observedClient;
  }

  observedClient = observeOpenAI(getOpenAIClient());
  return observedClient;
}

/**
 * Builds a client from the person's own key for one chat run or one request. It is never memoized, so the key
 * lives no longer than the run or request that carried it, and the platform's organization and project are
 * never attached to someone else's key.
 */
export function createUserOpenAIClient(userOpenAIApiKey: UserOpenAIApiKey): OpenAI {
  return new OpenAI({
    apiKey: userOpenAIApiKey.revealRawValue(),
    organization: null,
    project: null,
  });
}

/**
 * The observed counterpart of `createUserOpenAIClient`. The Langfuse wrapper records call arguments and
 * responses, never the client's configuration, so the key does not reach Langfuse through it.
 */
export function createObservedUserOpenAIClient(userOpenAIApiKey: UserOpenAIApiKey): OpenAI {
  const userClient = createUserOpenAIClient(userOpenAIApiKey);
  return isLangfuseConfigured(process.env) ? observeOpenAI(userClient) : userClient;
}
