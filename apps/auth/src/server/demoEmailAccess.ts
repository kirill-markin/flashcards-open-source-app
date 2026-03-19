type DemoEmailAccessConfig = Readonly<{
  emailAllowlist: ReadonlySet<string>;
  sharedPassword: string | null;
}>;

const demoEmailGuardianDomain = "example.com";

let resolvedDemoEmailAccessConfig: DemoEmailAccessConfig | undefined;

/**
 * Normalizes one configured review/demo email before validation and lookup.
 *
 * Demo email access is intentionally insecure and exists only for review/demo
 * accounts. Every allowlisted demo email must use the synthetic
 * `@example.com` guardian domain.
 */
function normalizeDemoEmailAccessValue(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns true only for emails inside the fixed guardian domain used by the
 * insecure review/demo bypass.
 */
function isGuardianDemoEmail(email: string): boolean {
  return email.endsWith(`@${demoEmailGuardianDomain}`);
}

/**
 * Parses and validates the configured review/demo allowlist.
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
      `DEMO_EMAIL_DOSTIP only supports insecure review/demo emails in @${demoEmailGuardianDomain}, got "${invalidEmail}"`,
    );
  }

  return new Set(normalizedValues);
}

/**
 * Loads the insecure review/demo bypass configuration from environment
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

  if (emailAllowlist.size > 0 && sharedPassword === "") {
    throw new Error(
      "DEMO_PASSWORD_DOSTIP is required when DEMO_EMAIL_DOSTIP is configured for insecure review/demo access",
    );
  }

  resolvedDemoEmailAccessConfig = {
    emailAllowlist,
    sharedPassword: sharedPassword === "" ? null : sharedPassword,
  };
  return resolvedDemoEmailAccessConfig;
}

/**
 * Returns the shared insecure demo password only for emails that are both
 * allowlisted and protected by the `@example.com` guardian restriction.
 */
export function getDemoEmailPassword(email: string): string | null {
  const config = getDemoEmailAccessConfig();
  const normalizedEmail = normalizeDemoEmailAccessValue(email);

  if (isGuardianDemoEmail(normalizedEmail) === false || config.emailAllowlist.has(normalizedEmail) === false) {
    return null;
  }

  if (config.sharedPassword === null) {
    throw new Error("DEMO_PASSWORD_DOSTIP is unavailable for configured demo email access");
  }

  return config.sharedPassword;
}

/**
 * Clears the cached review/demo bypass config for test isolation.
 */
export function resetDemoEmailAccessConfigForTests(): void {
  resolvedDemoEmailAccessConfig = undefined;
}
