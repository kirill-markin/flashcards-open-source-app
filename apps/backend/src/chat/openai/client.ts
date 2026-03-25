import OpenAI from "openai";

let client: OpenAI | null = null;

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  return apiKey;
}

export function getOpenAIClient(): OpenAI {
  if (client !== null) {
    return client;
  }

  client = new OpenAI({
    apiKey: getApiKey(),
  });
  return client;
}

export function getObservedOpenAIClient(): OpenAI {
  return getOpenAIClient();
}
