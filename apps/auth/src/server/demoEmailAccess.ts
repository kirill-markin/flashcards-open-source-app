import { getPlaintextSecret } from "./secrets.js";

type DemoEmailAccessConfig = Readonly<{
  emailAllowlist: ReadonlySet<string>;
  sharedPassword: string | null;
  passwordSecretArn: string | null;
}>;

const demoEmailGuardianDomain = "example.com";

let resolvedDemoEmailAccessConfig: DemoEmailAccessConfig | undefined;
let cachedDemoPasswordLoaders = new Map<string, Promise<string>>();
let plaintextSecretLoader: (secretArn: string) => Promise<string> = getPlaintextSecret;

/**
 * Normalizes one configured review account email before validation and lookup.
 *
 * `DEMO_EMAIL_DOSTIP` access is intentionally insecure and exists only for
 * review accounts. Every allowlisted email must use the synthetic
 * `@example.com` guardian domain.
 */
function normalizeDemoEmailAccessValue(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns true only for emails inside the fixed guardian domain used by the
 * insecure review account bypass.
 */
function isGuardianDemoEmail(email: string): boolean {
  return email.endsWith(`@${demoEmailGuardianDomain}`);
}

/**
 * Parses and validates the configured review account allowlist.
 *
 * The bypass is intentionally insecure, so every configured email must be an
 * explicit allowlist entry and must also belong to `@example.com`.
 */
function parseDemoEmailAllowlist(rawValue: string): ReadonlySet<string> {
  const normalizedValues = rawValue
    .split(",")
    .map((value) => normalizeDemoEmailAccessValue(value))
    .filter((value) => value !== "");

  const invalidEmail = normalizedValues.find((value) => isGuardianDemoEmail(value) === false);
  if (invalidEmail !== undefined) {
    throw new Error(
      `DEMO_EMAIL_DOSTIP only supports insecure review account emails in @${demoEmailGuardianDomain}, got "${invalidEmail}"`,
    );
  }

  return new Set(normalizedValues);
}

/**
 * Loads the insecure review account bypass configuration from environment
 * variables and validates that the shared password is present when the
 * allowlist is enabled.
 */
export function getDemoEmailAccessConfig(): DemoEmailAccessConfig {
  if (resolvedDemoEmailAccessConfig !== undefined) {
    return resolvedDemoEmailAccessConfig;
  }

  const rawAllowlist = process.env.DEMO_EMAIL_DOSTIP ?? "";
  const emailAllowlist = parseDemoEmailAllowlist(rawAllowlist);
  const sharedPassword = process.env.DEMO_PASSWORD_DOSTIP ?? "";
  const passwordSecretArn = process.env.DEMO_PASSWORD_SECRET_ARN ?? "";

  if (sharedPassword !== "" && passwordSecretArn !== "") {
    throw new Error(
      "Configure only one of DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN for insecure review account access",
    );
  }

  if (emailAllowlist.size > 0 && sharedPassword === "" && passwordSecretArn === "") {
    throw new Error(
      "DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN is required when DEMO_EMAIL_DOSTIP is configured for insecure review account access",
    );
  }

  resolvedDemoEmailAccessConfig = {
    emailAllowlist,
    sharedPassword: sharedPassword === "" ? null : sharedPassword,
    passwordSecretArn: passwordSecretArn === "" ? null : passwordSecretArn,
  };
  return resolvedDemoEmailAccessConfig;
}

function getCachedDemoPassword(secretArn: string): Promise<string> {
  const cachedPromise = cachedDemoPasswordLoaders.get(secretArn);
  if (cachedPromise !== undefined) {
    return cachedPromise;
  }

  const nextPromise = plaintextSecretLoader(secretArn);
  cachedDemoPasswordLoaders.set(secretArn, nextPromise);
  return nextPromise;
}

/**
 * Returns the shared insecure review account password only for emails that are
 * both
 * allowlisted and protected by the `@example.com` guardian restriction.
 */
export async function getDemoEmailPassword(email: string): Promise<string | null> {
  const config = getDemoEmailAccessConfig();
  const normalizedEmail = normalizeDemoEmailAccessValue(email);

  if (isGuardianDemoEmail(normalizedEmail) === false || config.emailAllowlist.has(normalizedEmail) === false) {
    return null;
  }

  if (config.sharedPassword !== null) {
    return config.sharedPassword;
  }

  if (config.passwordSecretArn === null) {
    throw new Error("DEMO_PASSWORD_DOSTIP and DEMO_PASSWORD_SECRET_ARN are unavailable for configured review account access");
  }

  return getCachedDemoPassword(config.passwordSecretArn);
}

export function setPlaintextSecretLoaderForTests(
  loader: ((secretArn: string) => Promise<string>) | null,
): void {
  plaintextSecretLoader = loader ?? getPlaintextSecret;
  cachedDemoPasswordLoaders = new Map<string, Promise<string>>();
}

/**
 * Clears the cached review account bypass config for test isolation.
 */
export function resetDemoEmailAccessConfigForTests(): void {
  resolvedDemoEmailAccessConfig = undefined;
  cachedDemoPasswordLoaders = new Map<string, Promise<string>>();
  plaintextSecretLoader = getPlaintextSecret;
}
