import { handle } from "hono/aws-lambda";
import { createApp } from "./app";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();
const app = createApp("");

/**
 * Keeps the default buffered Lambda proxy behavior for the main backend
 * routes such as `/health`, `/me`, workspace-scoped sync JSON endpoints,
 * and the backend-owned chat control-plane endpoints.
 *
 * Those endpoints return complete JSON payloads, so streaming would add no
 * benefit and would make API Gateway treat every route as a streaming
 * integration.
 */
export const handler = handle(app);
