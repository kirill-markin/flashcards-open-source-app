import { readRsaSigningKeyFile, type RsaSigningKey } from "../rsaKeyFile.js";

/**
 * Settings of AUTH_IDENTITY_PROVIDER=local. The backend's AUTH_MODE=local verifies the same issuer
 * and audience (apps/backend/src/auth/localIdentityVerifier.ts).
 */
export type LocalIdentityConfig = Readonly<{
  issuer: string;
  audience: string;
  signingKey: RsaSigningKey;
  allowedEmails: ReadonlySet<string>;
  allowedEmailDomains: ReadonlySet<string>;
  smtpUrl: string;
  smtpFrom: string;
}>;

export const localIdTokenAudience = "nibomo-standalone";
export const localIdTokenTtlSeconds = 3_600;
// Absolute lifetime matches the Cognito refresh token (infra/aws/lib/auth.ts); idle expiry is extra.
export const localSessionIdleTtlSeconds = 180 * 86_400;
export const localSessionAbsoluteTtlSeconds = 3_650 * 86_400;

let resolvedConfig: LocalIdentityConfig | undefined;

function requireSetting(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") throw new Error(`${name} is required when AUTH_IDENTITY_PROVIDER=local.`);
  return value;
}

function parseList(name: string): ReadonlySet<string> {
  return new Set((process.env[name] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => item !== ""));
}

function parseSmtpUrl(): string {
  const value = requireSetting("SMTP_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMTP_URL must be an smtp:// or smtps:// URL, such as smtps://user:password@smtp.example.com:465.");
  }
  if ((url.protocol !== "smtp:" && url.protocol !== "smtps:") || url.hostname === "") {
    throw new Error(`SMTP_URL must be an smtp:// or smtps:// URL with a host, got protocol "${url.protocol}".`);
  }
  return value;
}

export function getLocalIdentityConfig(): LocalIdentityConfig {
  if (resolvedConfig !== undefined) return resolvedConfig;

  const allowedEmails = parseList("LOCAL_AUTH_ALLOWED_EMAILS");
  const allowedEmailDomains = parseList("LOCAL_AUTH_ALLOWED_EMAIL_DOMAINS");
  if (allowedEmails.size === 0 && allowedEmailDomains.size === 0) {
    throw new Error("AUTH_IDENTITY_PROVIDER=local requires LOCAL_AUTH_ALLOWED_EMAILS or LOCAL_AUTH_ALLOWED_EMAIL_DOMAINS: signup is closed to everyone else.");
  }

  resolvedConfig = {
    issuer: new URL(requireSetting("PUBLIC_AUTH_BASE_URL")).origin,
    audience: localIdTokenAudience,
    signingKey: readRsaSigningKeyFile("LOCAL_AUTH_SIGNING_KEY_FILE"),
    allowedEmails,
    allowedEmailDomains,
    smtpUrl: parseSmtpUrl(),
    smtpFrom: requireSetting("SMTP_FROM"),
  };
  return resolvedConfig;
}

/** Whether an address with no local identity yet may create one. */
export function isEmailAllowedToRegister(config: LocalIdentityConfig, email: string): boolean {
  return config.allowedEmails.has(email) || config.allowedEmailDomains.has(email.slice(email.lastIndexOf("@") + 1));
}
