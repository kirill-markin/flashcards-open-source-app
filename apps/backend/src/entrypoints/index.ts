import { serve } from "@hono/node-server";
import { createApp } from "../server/app";
import { initializeBackendSentry } from "../observability/sentry";

async function main(): Promise<void> {
  initializeBackendSentry("backend-api");
  const app = createApp("/v1");
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  // Unset binds every interface, which the compose auth container needs to reach this backend
  // through host.docker.internal. The scripts/local/ loops set 127.0.0.1: their insecure local auth
  // trusts the client-supplied Host header, so only a loopback bind keeps the network out.
  const hostname = process.env.BACKEND_BIND_HOST;

  serve({ fetch: app.fetch, port, hostname }, (info) => {
    // Handed to `console` as an object rather than pre-serialized, for the same reason
    // `writeCloudWatchRecord` is (apps/backend/src/observability/cloudWatch.ts): a pre-serialized
    // record leaves `message` a string under the Lambda JSON log format, with nothing inside it
    // addressable. This entrypoint is development-only and these two lifecycle lines would never be
    // read by a metric filter, but they are backend records, and one rule with no exceptions is what
    // keeps the rule checkable.
    console.log({ domain: "backend", action: "start", port: info.port });
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error({ domain: "backend", action: "startup_failed", error: message });
  process.exit(1);
});
