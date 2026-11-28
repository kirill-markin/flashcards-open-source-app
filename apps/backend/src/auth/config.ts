import { isStandaloneDeployment } from "../deployment/standalone";
import { assertLocalIdTokenVerifierConfigured } from "./localIdentityVerifier";

export type AuthConfig =
  | Readonly<{ mode: "cognito" }>
  | Readonly<{ mode: "local" }>
  | Readonly<{ mode: "guest" }>
  | Readonly<{ mode: "none" }>;

let resolvedAuthConfig: AuthConfig | undefined;

function parseBooleanEnv(value: string | undefined, variableName: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${variableName} must be set to "true" or "false" when provided`);
}

/**
 * Validates backend auth mode eagerly so the process fails closed on startup
 * instead of silently falling back to insecure local auth.
 *
 * `AUTH_MODE` is always required. `AUTH_MODE=none` is allowed only when
 * `ALLOW_INSECURE_LOCAL_AUTH=true` is set explicitly for local development.
 * Standalone, which has no Cognito, uses `local` (the auth service's own email
 * sign-in, ./localIdentityVerifier.ts) or `guest` (guest sessions only).
 */
export function getAuthConfig(): AuthConfig {
  if (resolvedAuthConfig !== undefined) {
    return resolvedAuthConfig;
  }

  const authMode = process.env.AUTH_MODE;
  if (authMode === undefined || authMode === "") {
    throw new Error('AUTH_MODE is required and must be set to "cognito", "local", "guest" or "none"');
  }

  if (authMode === "cognito") {
    if (isStandaloneDeployment()) {
      throw new Error('NIBOMO_DEPLOYMENT=standalone has no Cognito; set AUTH_MODE to "local" or "guest".');
    }
    resolvedAuthConfig = { mode: "cognito" };
    return resolvedAuthConfig;
  }

  if (authMode === "local" || authMode === "guest") {
    if (!isStandaloneDeployment()) {
      throw new Error(`AUTH_MODE="${authMode}" requires NIBOMO_DEPLOYMENT=standalone.`);
    }
    if ((process.env.DEMO_EMAIL_DOSTIP ?? "").trim() !== "") {
      throw new Error(`DEMO_EMAIL_DOSTIP serves Cognito review accounts; unset it when AUTH_MODE="${authMode}".`);
    }
    if (authMode === "local") assertLocalIdTokenVerifierConfigured();
    const config: AuthConfig = { mode: authMode };
    resolvedAuthConfig = config;
    return config;
  }

  if (authMode === "none") {
    const allowInsecureLocalAuth = parseBooleanEnv(
      process.env.ALLOW_INSECURE_LOCAL_AUTH,
      "ALLOW_INSECURE_LOCAL_AUTH",
    );
    if (allowInsecureLocalAuth === false) {
      throw new Error(
        'AUTH_MODE="none" requires ALLOW_INSECURE_LOCAL_AUTH=true and must be used only for local development',
      );
    }

    resolvedAuthConfig = { mode: "none" };
    return resolvedAuthConfig;
  }

  throw new Error(`AUTH_MODE must be set to "cognito", "local", "guest" or "none", got "${authMode}"`);
}

export function resetAuthConfigForTests(): void {
  resolvedAuthConfig = undefined;
}
