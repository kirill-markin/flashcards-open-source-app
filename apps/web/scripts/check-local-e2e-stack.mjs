const localAppBaseUrl = "http://localhost:3000";
const localApiBaseUrl = "http://localhost:8080/v1";
const localAuthBaseUrl = "http://localhost:8081";

await assertEndpointHealthy(`${localAuthBaseUrl}/health`, "local auth");
await assertEndpointHealthy(`${localApiBaseUrl}/health`, "local backend");
await assertLocalAuthAcceptsRedirect();

console.log("Local web smoke preflight passed.");

async function assertEndpointHealthy(url, label) {
  const response = await fetchWithTimeout(url, 5_000);

  if (response.ok === false) {
    throw new Error(
      `${label} health check failed at ${url} with status ${String(response.status)}. `
      + "Start the local stack before running npm run test:e2e:local.",
    );
  }
}

async function assertLocalAuthAcceptsRedirect() {
  const loginUrl = new URL(`${localAuthBaseUrl}/login`);
  loginUrl.searchParams.set("redirect_uri", `${localAppBaseUrl}/review`);

  const response = await fetchWithTimeout(loginUrl.toString(), 5_000, {
    redirect: "manual",
  });

  if (response.status === 400) {
    const body = await response.text();
    throw new Error(
      `Local auth rejected localhost redirect_uri at ${loginUrl.toString()}: ${body}. `
      + "Keep ALLOWED_REDIRECT_URIS=http://localhost:3000 in the local auth config.",
    );
  }

  if (response.ok === false && response.status !== 302) {
    throw new Error(
      `Local auth preflight returned status ${String(response.status)} for ${loginUrl.toString()}.`,
    );
  }
}

async function fetchWithTimeout(url, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Timed out after ${String(timeoutMs)} ms while reaching ${url}. `
        + "Start make db-up, make auth-dev, and make backend-dev before the local smoke.",
      );
    }

    throw new Error(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}. `
      + "Start make db-up, make auth-dev, and make backend-dev before the local smoke.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
