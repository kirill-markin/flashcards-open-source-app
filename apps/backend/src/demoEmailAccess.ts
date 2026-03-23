type DemoEmailAccessConfig = Readonly<{
  emailAllowlist: ReadonlySet<string>;
}>;

const demoEmailGuardianDomain = "example.com";

let resolvedDemoEmailAccessConfig: DemoEmailAccessConfig | undefined;

function normalizeDemoEmailValue(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns true only for the insecure review/demo accounts that must stay
 * inside the fixed `@example.com` guardian domain.
 */
function isGuardianDemoEmail(email: string): boolean {
  return email.endsWith(`@${demoEmailGuardianDomain}`);
}

/**
 * Parses the backend demo allowlist from `DEMO_EMAIL_DOSTIP`.
 *
 * This config exists only for the insecure review/demo accounts in the
 * `@example.com` domain. Real user emails must never be treated as demo
 * accounts by this helper.
 */
function parseDemoEmailAllowlist(rawValue: string): ReadonlySet<string> {
  const normalizedValues = rawValue
    .split(",")
    .map((value) => normalizeDemoEmailValue(value))
    .filter((value) => value !== "");

  const invalidEmail = normalizedValues.find((value) => isGuardianDemoEmail(value) === false);
  if (invalidEmail !== undefined) {
    throw new Error(
      `DEMO_EMAIL_DOSTIP only supports insecure review/demo emails in @${demoEmailGuardianDomain}, got "${invalidEmail}"`,
    );
  }

  return new Set(normalizedValues);
}

function getDemoEmailAccessConfig(): DemoEmailAccessConfig {
  if (resolvedDemoEmailAccessConfig !== undefined) {
    return resolvedDemoEmailAccessConfig;
  }

  resolvedDemoEmailAccessConfig = {
    emailAllowlist: parseDemoEmailAllowlist(process.env.DEMO_EMAIL_DOSTIP ?? ""),
  };
  return resolvedDemoEmailAccessConfig;
}

/**
 * Returns true only for configured insecure review/demo accounts from
 * `DEMO_EMAIL_DOSTIP`.
 *
 * This check is intentionally limited to the explicit allowlist of
 * `@example.com` demo emails. All real accounts must follow the normal
 * deletion flow that removes both data and the Cognito identity.
 */
export function isConfiguredDemoEmail(email: string | null): boolean {
  if (email === null) {
    return false;
  }

  const normalizedEmail = normalizeDemoEmailValue(email);
  const config = getDemoEmailAccessConfig();

  return isGuardianDemoEmail(normalizedEmail) && config.emailAllowlist.has(normalizedEmail);
}

export function resetDemoEmailAccessConfigForTests(): void {
  resolvedDemoEmailAccessConfig = undefined;
}
