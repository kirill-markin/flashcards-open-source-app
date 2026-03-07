import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp("/v1");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ domain: "backend", action: "start", port: info.port }));
});
