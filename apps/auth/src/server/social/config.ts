import { createPrivateKey, type KeyObject } from "node:crypto";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { logWarning } from "../logger.js";
import { parseProviderObject, SocialProofError } from "./providers.js";

const secretsClient = new SecretsManagerClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000, throwOnRequestTimeout: true },
});
secretsClient.middlewareStack.add((next) => async (args) => {
  try {
    return await next(args);
  } catch (error) {
    logWarning({ domain: "auth", action: "error", code: "PROVIDER_SECRET_ATTEMPT_FAILED" });
    throw error;
  }
}, { step: "finalizeRequest", priority: "low", name: "providerSecretAttemptLogger" });

export type GoogleSignInConfig = Readonly<{
  serverClientId: string;
  iosClientId: string;
  iosDevelopmentClientId: string;
  androidClientIds: ReadonlyArray<string>;
}>;
export type AppleSignInConfig = Readonly<{
  serviceId: string;
  iosClientId: string;
  iosDevelopmentClientId: string;
}>;
export type AppleSigningSecret = Readonly<{ teamId: string; keyId: string; serviceId: string; privateKey: KeyObject }>;

function readConfiguration(provider: "GOOGLE" | "APPLE"): Record<string, unknown> | null {
  const json = process.env[`${provider}_SIGN_IN_CONFIG`];
  const arn = process.env[`${provider}_SIGN_IN_SECRET_ARN`];
  if (json === undefined && arn === undefined) return null;
  if (json === undefined || arn === undefined || !/^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(arn)) {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
  return parseProviderObject(json, "PROVIDER_CONFIGURATION_INVALID");
}

function readClientId(config: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = config[key];
  if (typeof value !== "string" || !pattern.test(value)) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return value;
}

const googleClientPattern = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const appleClientPattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function getGoogleSignInConfig(): GoogleSignInConfig | null {
  const config = readConfiguration("GOOGLE");
  if (config === null) return null;
  if (!Array.isArray(config.androidClientIds) || config.androidClientIds.length < 1 || config.androidClientIds.length > 10
    || !config.androidClientIds.every((value: unknown) => typeof value === "string" && googleClientPattern.test(value))) {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
  const result = {
    serverClientId: readClientId(config, "serverClientId", googleClientPattern),
    iosClientId: readClientId(config, "iosClientId", googleClientPattern),
    iosDevelopmentClientId: readClientId(config, "iosDevelopmentClientId", googleClientPattern),
    androidClientIds: config.androidClientIds as Array<string>,
  };
  const ids = [result.serverClientId, result.iosClientId, result.iosDevelopmentClientId, ...result.androidClientIds];
  if (new Set(ids).size !== ids.length) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return result;
}

export function getAppleSignInConfig(): AppleSignInConfig | null {
  const config = readConfiguration("APPLE");
  if (config === null) return null;
  const result = {
    serviceId: readClientId(config, "serviceId", appleClientPattern),
    iosClientId: readClientId(config, "iosClientId", appleClientPattern),
    iosDevelopmentClientId: readClientId(config, "iosDevelopmentClientId", appleClientPattern),
  };
  if (new Set(Object.values(result)).size !== 3) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return result;
}

async function loadProviderSecret(provider: "GOOGLE" | "APPLE"): Promise<Record<string, unknown>> {
  const arn = process.env[`${provider}_SIGN_IN_SECRET_ARN`];
  if (arn === undefined) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  try {
    const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }), {
      abortSignal: AbortSignal.timeout(8_000),
    });
    if (response.SecretString === undefined) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
    return parseProviderObject(response.SecretString, "PROVIDER_CONFIGURATION_INVALID");
  } catch (error) {
    if (error instanceof SocialProofError) throw error;
    logWarning({ domain: "auth", action: "error", code: "PROVIDER_SECRET_LOAD_FAILED", reasonCategory: provider });
    throw new SocialProofError("PROVIDER_TEMPORARILY_UNAVAILABLE");
  }
}

export async function loadGoogleSignInSecret(config: GoogleSignInConfig): Promise<Readonly<{ clientId: string; clientSecret: string }>> {
  const secret = await loadProviderSecret("GOOGLE");
  if (secret.clientId !== config.serverClientId || typeof secret.clientSecret !== "string" || secret.clientSecret.length < 16) {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
  return { clientId: config.serverClientId, clientSecret: secret.clientSecret };
}

export async function loadAppleSigningSecret(config: AppleSignInConfig): Promise<AppleSigningSecret> {
  const secret = await loadProviderSecret("APPLE");
  if (typeof secret.teamId !== "string" || !/^[A-Z0-9]{10}$/.test(secret.teamId)
    || typeof secret.keyId !== "string" || !/^[A-Z0-9]{10}$/.test(secret.keyId)
    || secret.serviceId !== config.serviceId || typeof secret.privateKey !== "string") {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
  try {
    const privateKey = createPrivateKey(secret.privateKey);
    if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
    }
    return { teamId: secret.teamId, keyId: secret.keyId, serviceId: config.serviceId, privateKey };
  } catch {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
}
