import { isIP } from "node:net";
import OpenAI from "openai";
import { isStandaloneDeployment } from "../../deployment/standalone";
import type { UserOpenAIApiKey } from "../userOpenAIApiKey";

const openAIBaseUrlVariableName = "OPENAI_BASE_URL";
const openAIModelVariableName = "OPENAI_MODEL";

/**
 * Standalone may point every OpenAI client at an OpenAI-compatible endpoint and send one model instead
 * of the built-in ones. `baseURL` undefined leaves the SDK on its default endpoint.
 */
type OpenAIProviderSettings = Readonly<{
  baseURL: string | undefined;
  modelOverride: string | null;
}>;

let client: OpenAI | null = null;
let resolvedProviderSettings: OpenAIProviderSettings | undefined;

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  return apiKey;
}

function readOptionalSetting(variableName: string): string | null {
  const value = process.env[variableName]?.trim();
  return value === undefined || value === "" ? null : value;
}

/** Plain http only reaches this host or a compose service, whose single-label name is not a public domain. */
function isPrivateHttpHostname(hostname: string): boolean {
  const bareHostname = hostname.replace(/^\[(.*)\]$/u, "$1");
  if (bareHostname === "localhost" || bareHostname === "::1" || /^127\.\d+\.\d+\.\d+$/u.test(bareHostname)) {
    return true;
  }

  return isIP(bareHostname) === 0 && !bareHostname.includes(".");
}

// The value is never echoed: a mistyped URL can carry a credential.
function parseOpenAIBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${openAIBaseUrlVariableName} must be an absolute URL such as https://llm.example.com/v1.`);
  }

  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`${openAIBaseUrlVariableName} must not carry credentials, a query or a fragment; the key is OPENAI_API_KEY.`);
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && isPrivateHttpHostname(url.hostname))) {
    return url.href;
  }

  throw new Error(
    `${openAIBaseUrlVariableName} must use https, or http only for localhost, a loopback address or a compose service name.`,
  );
}

function evaluateProviderSettings(): OpenAIProviderSettings {
  const baseUrl = readOptionalSetting(openAIBaseUrlVariableName);
  const model = readOptionalSetting(openAIModelVariableName);
  if (!isStandaloneDeployment()) {
    // The SDK would read OPENAI_BASE_URL on its own, so outside standalone a set one is refused, not followed.
    const strayVariableName = baseUrl !== null ? openAIBaseUrlVariableName : model !== null ? openAIModelVariableName : null;
    if (strayVariableName !== null) {
      throw new Error(`${strayVariableName} is read only when NIBOMO_DEPLOYMENT=standalone; unset it.`);
    }
    return { baseURL: undefined, modelOverride: null };
  }

  if (model !== null && /\s/u.test(model)) {
    throw new Error(`${openAIModelVariableName} must be one model name without whitespace.`);
  }
  return { baseURL: baseUrl === null ? undefined : parseOpenAIBaseUrl(baseUrl), modelOverride: model };
}

function getProviderSettings(): OpenAIProviderSettings {
  if (resolvedProviderSettings === undefined) {
    resolvedProviderSettings = evaluateProviderSettings();
  }
  return resolvedProviderSettings;
}

/**
 * Test-only: points every OpenAI client at a local fake provider without the standalone switch, or with null
 * drops the override and both cached values so the environment is read again.
 */
export function setOpenAIBaseUrlForTests(baseURL: string | null): void {
  resolvedProviderSettings = baseURL === null ? undefined : { baseURL, modelOverride: null };
  client = null;
}

/** Fails at boot on a misconfigured endpoint or model instead of on the first chat turn. */
export function validateOpenAIProviderSettings(): void {
  getProviderSettings();
}

/** The model sent to the provider and recorded as `ai.usage_events.model_id` for a built-in model id. */
export function resolveChatModel(builtInModelId: string): string {
  return getProviderSettings().modelOverride ?? builtInModelId;
}

export function getOpenAIClient(): OpenAI {
  if (client !== null) {
    return client;
  }

  client = new OpenAI({
    apiKey: getApiKey(),
    baseURL: getProviderSettings().baseURL,
  });
  return client;
}

/**
 * Builds a client from the person's own key for one chat run or one request. It is never memoized, so the key
 * lives no longer than the run or request that carried it, and the platform's organization and project are
 * never attached to someone else's key.
 */
export function createUserOpenAIClient(userOpenAIApiKey: UserOpenAIApiKey): OpenAI {
  return new OpenAI({
    apiKey: userOpenAIApiKey.revealRawValue(),
    baseURL: getProviderSettings().baseURL,
    organization: null,
    project: null,
  });
}
