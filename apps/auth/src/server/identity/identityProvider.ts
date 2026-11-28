import { isStandaloneDeployment } from "../deployment.js";

/**
 * Who proves an email address: Cognito on AWS, or on standalone either this service's own emailed
 * codes (`local`) or nobody (`none`, guest-only). The backend's matching AUTH_MODE is local or guest.
 */
export type IdentityProvider = "cognito" | "local" | "none";

/** Settings read only by the standalone providers; outside standalone a set one is refused. */
const standaloneIdentityVariableNames: ReadonlyArray<string> = [
  "AUTH_IDENTITY_PROVIDER",
  "SMTP_URL",
  "SMTP_FROM",
  "LOCAL_AUTH_ALLOWED_EMAILS",
  "LOCAL_AUTH_ALLOWED_EMAIL_DOMAINS",
];

let resolvedIdentityProvider: IdentityProvider | undefined;

function evaluateIdentityProvider(): IdentityProvider {
  if (!isStandaloneDeployment()) {
    const strayName = standaloneIdentityVariableNames.find((name) => process.env[name] !== undefined);
    if (strayName !== undefined) {
      throw new Error(`${strayName} is read only when NIBOMO_DEPLOYMENT=standalone; unset it or set the switch.`);
    }
    return "cognito";
  }

  const value = process.env.AUTH_IDENTITY_PROVIDER;
  if (value === "local" || value === "none") return value;
  throw new Error(`NIBOMO_DEPLOYMENT=standalone requires AUTH_IDENTITY_PROVIDER to be "local" or "none", got "${value ?? ""}".`);
}

export function getIdentityProvider(): IdentityProvider {
  if (resolvedIdentityProvider === undefined) {
    resolvedIdentityProvider = evaluateIdentityProvider();
  }
  return resolvedIdentityProvider;
}

/** A route this provider does not offer, refused explicitly rather than failing inside Cognito code. */
export class SignInUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInUnavailableError";
  }
}

/**
 * Why this provider refuses a route, or null when it serves it. Guest-only answers everything but
 * the health probe; local email sign-in has no social sign-in, account-method management or
 * current-email reauthentication, which are Cognito features.
 */
export function getIdentityRouteRefusal(provider: IdentityProvider, routePath: string): string | null {
  if (provider === "none") {
    return routePath === "/health" || routePath === "/robots.txt"
      ? null : "Sign-in is disabled on this server. Continue as a guest.";
  }
  if (provider === "local" && (routePath.startsWith("/api/social/") || routePath.startsWith("/api/account/"))) {
    return "Only email-code sign-in is available on this server.";
  }
  return null;
}
