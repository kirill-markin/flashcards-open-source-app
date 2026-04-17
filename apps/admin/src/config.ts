export type AdminAppConfig = Readonly<{
  apiBaseUrl: string;
  authBaseUrl: string;
}>;

const adminHostnamePrefix = "admin.";

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost";
}

function getAdminBaseDomain(hostname: string): string | undefined {
  if (!hostname.startsWith(adminHostnamePrefix)) {
    return undefined;
  }

  const baseDomain = hostname.slice(adminHostnamePrefix.length);
  if (baseDomain.trim() === "") {
    return undefined;
  }

  return baseDomain;
}

function getUnsupportedAdminHostErrorMessage(hostname: string): string {
  return [
    `Unsupported admin hostname: ${hostname}.`,
    "Supported admin entrypoints are http://localhost:3001 and https://admin.<domain>.",
  ].join(" ");
}

export function getAdminAppConfig(): AdminAppConfig {
  const hostname = window.location.hostname;

  let apiBaseUrl: string;
  let authBaseUrl: string;

  if (isLocalHostname(hostname)) {
    apiBaseUrl = "http://localhost:8080/v1";
    authBaseUrl = "http://localhost:8081";
  } else {
    const baseDomain = getAdminBaseDomain(hostname);
    if (baseDomain !== undefined) {
      apiBaseUrl = `https://api.${baseDomain}/v1`;
      authBaseUrl = `https://auth.${baseDomain}`;
    } else {
      throw new Error(getUnsupportedAdminHostErrorMessage(hostname));
    }
  }

  return {
    apiBaseUrl,
    authBaseUrl,
  };
}
