export type AppConfig = Readonly<{
  apiBaseUrl: string;
  authBaseUrl: string;
  appBaseUrl: string;
}>;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getLocalApiBaseUrl(): string {
  return "http://localhost:8080/v1";
}

function getLocalAuthBaseUrl(): string {
  return "http://localhost:8081";
}

function getBaseDomain(hostname: string): string {
  return hostname.startsWith("app.") ? hostname.slice(4) : hostname;
}

export function getAppConfig(): AppConfig {
  const appBaseUrl = stripTrailingSlash(import.meta.env.VITE_APP_BASE_URL ?? window.location.origin);
  const hostname = window.location.hostname;
  const baseDomain = getBaseDomain(hostname);
  const apiBaseUrl = stripTrailingSlash(
    import.meta.env.VITE_API_BASE_URL ?? (
      hostname === "localhost" || hostname === "127.0.0.1"
        ? getLocalApiBaseUrl()
        : `https://api.${baseDomain}/v1`
    ),
  );
  const authBaseUrl = stripTrailingSlash(
    import.meta.env.VITE_AUTH_BASE_URL ?? (
      hostname === "localhost" || hostname === "127.0.0.1"
        ? getLocalAuthBaseUrl()
        : `https://auth.${baseDomain}`
    ),
  );

  return {
    apiBaseUrl,
    authBaseUrl,
    appBaseUrl,
  };
}
