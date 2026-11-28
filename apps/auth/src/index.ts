import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { isStandaloneDeployment } from "./server/deployment.js";
import { getIdentityProvider } from "./server/identity/identityProvider.js";
import { getLocalIdentityConfig } from "./server/local/localConfig.js";
import { runWithSocialSourceIp } from "./server/social/requestSource.js";

const validateEnv = (): void => {
  // Standalone forbids the Cognito variables (./server/deployment.ts) and never trusts the request
  // Host for a public URL, so it requires the configured ones and its identity provider's settings.
  const requiredVariableNames: ReadonlyArray<string> = isStandaloneDeployment()
    ? ["SESSION_ENCRYPTION_KEY", "ALLOWED_REDIRECT_URIS", "COOKIE_DOMAIN",
      "PUBLIC_AUTH_BASE_URL", "PUBLIC_API_BASE_URL", "PUBLIC_APP_BASE_URL"]
    : ["COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID", "COGNITO_REGION",
      "SESSION_ENCRYPTION_KEY", "ALLOWED_REDIRECT_URIS", "COOKIE_DOMAIN"];
  const missing = requiredVariableNames.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Auth service missing required env vars: ${missing.join(", ")}`);
  }
  if (!isStandaloneDeployment()) return;

  const appOrigin = new URL(process.env.PUBLIC_APP_BASE_URL ?? "").origin;
  if (!(process.env.ALLOWED_REDIRECT_URIS ?? "").split(",").map((value) => value.trim()).includes(appOrigin)) {
    throw new Error(`ALLOWED_REDIRECT_URIS must include the PUBLIC_APP_BASE_URL origin ${appOrigin}.`);
  }
  if (getIdentityProvider() === "local") getLocalIdentityConfig();
};

// A misconfigured deployment switch fails at boot rather than on the first request that reads it.
isStandaloneDeployment();

if (process.env.NODE_ENV !== "development") {
  validateEnv();
}

const app = createApp("/");

const port = parseInt(process.env.PORT ?? "8081", 10);

serve({
  fetch: (request, bindings) => runWithSocialSourceIp(
    bindings.incoming.socket.remoteAddress ?? null, async () => app.fetch(request, bindings),
  ),
  port,
}, (info) => {
  console.log(JSON.stringify({ domain: "auth", action: "start", port: info.port }));
});
