export type AuthConfig =
  | Readonly<{ mode: "cognito" }>
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
 */
export function getAuthConfig(): AuthConfig {
  if (resolvedAuthConfig !== undefined) {
    return resolvedAuthConfig;
  }

  const authMode = process.env.AUTH_MODE;
  if (authMode === undefined || authMode === "") {
    throw new Error('AUTH_MODE is required and must be set to "cognito" or "none"');
  }

  if (authMode === "cognito") {
    resolvedAuthConfig = { mode: "cognito" };
    return resolvedAuthConfig;
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

  throw new Error(`AUTH_MODE must be set to "cognito" or "none", got "${authMode}"`);
}

export function resetAuthConfigForTests(): void {
  resolvedAuthConfig = undefined;
}
