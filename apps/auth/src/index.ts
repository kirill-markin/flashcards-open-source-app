import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { runWithSocialSourceIp } from "./server/social/requestSource.js";

const validateEnv = (): void => {
  const errors: Array<string> = [];
  if (!process.env.COGNITO_USER_POOL_ID) errors.push("COGNITO_USER_POOL_ID");
  if (!process.env.COGNITO_CLIENT_ID) errors.push("COGNITO_CLIENT_ID");
  if (!process.env.COGNITO_REGION) errors.push("COGNITO_REGION");
  if (!process.env.SESSION_ENCRYPTION_KEY) errors.push("SESSION_ENCRYPTION_KEY");
  if (!process.env.ALLOWED_REDIRECT_URIS) errors.push("ALLOWED_REDIRECT_URIS");
  if (!process.env.COOKIE_DOMAIN) errors.push("COOKIE_DOMAIN");
  if (errors.length > 0) {
    throw new Error(`Auth service missing required env vars: ${errors.join(", ")}`);
  }
};

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
