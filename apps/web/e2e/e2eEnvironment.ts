export type E2eTarget = "local" | "prod";

export type E2eEnvironment = Readonly<{
  target: E2eTarget;
  appBaseUrl: string;
  apiBaseUrl: string;
  authBaseUrl: string;
}>;

const localEnvironmentDefaults: Omit<E2eEnvironment, "target"> = {
  appBaseUrl: "http://localhost:3000",
  apiBaseUrl: "http://localhost:8080/v1",
  authBaseUrl: "http://localhost:8081",
};

const prodEnvironmentDefaults: Omit<E2eEnvironment, "target"> = {
  appBaseUrl: "https://app.flashcards-open-source-app.com",
  apiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
  authBaseUrl: "https://auth.flashcards-open-source-app.com",
};

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveE2eTarget(rawTarget: string | undefined): E2eTarget {
  if (rawTarget === undefined || rawTarget === "") {
    return "prod";
  }

  if (rawTarget === "local" || rawTarget === "prod") {
    return rawTarget;
  }

  throw new Error(`Invalid FLASHCARDS_E2E_TARGET value "${rawTarget}". Use "local" or "prod".`);
}

function isLoopbackUrl(value: string): boolean {
  const url = new URL(value);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function resolveE2eEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): E2eEnvironment {
  const target = resolveE2eTarget(env.FLASHCARDS_E2E_TARGET);
  const defaults = target === "local" ? localEnvironmentDefaults : prodEnvironmentDefaults;

  return {
    target,
    appBaseUrl: stripTrailingSlash(env.FLASHCARDS_E2E_APP_BASE_URL ?? defaults.appBaseUrl),
    apiBaseUrl: stripTrailingSlash(env.FLASHCARDS_E2E_API_BASE_URL ?? defaults.apiBaseUrl),
    authBaseUrl: stripTrailingSlash(env.FLASHCARDS_E2E_AUTH_BASE_URL ?? defaults.authBaseUrl),
  };
}

export function validateE2eEnvironment(environment: E2eEnvironment): void {
  if (environment.target === "local") {
    if (environment.appBaseUrl !== localEnvironmentDefaults.appBaseUrl) {
      throw new Error(
        `Local web smoke requires FLASHCARDS_E2E_APP_BASE_URL=${localEnvironmentDefaults.appBaseUrl}. `
        + `Received ${environment.appBaseUrl}.`,
      );
    }

    if (environment.apiBaseUrl !== localEnvironmentDefaults.apiBaseUrl) {
      throw new Error(
        `Local web smoke requires FLASHCARDS_E2E_API_BASE_URL=${localEnvironmentDefaults.apiBaseUrl}. `
        + `Received ${environment.apiBaseUrl}.`,
      );
    }

    if (environment.authBaseUrl !== localEnvironmentDefaults.authBaseUrl) {
      throw new Error(
        `Local web smoke requires FLASHCARDS_E2E_AUTH_BASE_URL=${localEnvironmentDefaults.authBaseUrl}. `
        + `Received ${environment.authBaseUrl}.`,
      );
    }

    return;
  }

  const loopbackUrls = [environment.appBaseUrl, environment.apiBaseUrl, environment.authBaseUrl]
    .filter((value) => isLoopbackUrl(value));

  if (loopbackUrls.length > 0) {
    throw new Error(
      `Prod web smoke must not use loopback origins. Received: ${loopbackUrls.join(", ")}.`,
    );
  }
}

export function getLocalE2eEnvironmentDefaults(): Omit<E2eEnvironment, "target"> {
  return localEnvironmentDefaults;
}
