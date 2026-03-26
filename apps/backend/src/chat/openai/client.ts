/**
 * Shared OpenAI client access for the backend-owned chat runtime.
 * The client is memoized per process because the server owns model selection and provider configuration.
 */
import OpenAI from "openai";

let client: OpenAI | null = null;

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
  return getOpenAIClient();
}
