import { serve } from "@hono/node-server";
import { createApp } from "./app";

async function main(): Promise<void> {
  const app = createApp("/v1");
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(JSON.stringify({ domain: "backend", action: "start", port: info.port }));
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ domain: "backend", action: "startup_failed", error: message }));
  process.exit(1);
});
