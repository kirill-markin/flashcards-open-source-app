import { streamHandle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp("");

/**
 * Uses Lambda response streaming for the whole Hono app because the `/chat`
 * route emits Server-Sent Events.
 *
 * `handle(app)` converts the web `Response` into the classic buffered Lambda
 * proxy result, which collapses SSE chunks into one final body and breaks the
 * browser-side event parser. `streamHandle(app)` keeps the response body as a
 * stream so API Gateway can forward chat deltas incrementally.
 *
 * The entry point stays global because Lambda cannot switch adapters per route.
 * Non-chat routes remain safe because API Gateway still uses buffered transfer
 * mode for them.
 */
export const handler = streamHandle(app);
