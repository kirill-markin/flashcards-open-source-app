import { streamHandle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp("");

/**
 * Uses the streaming Lambda adapter only for the `/chat` API integration.
 *
 * The chat route returns Server-Sent Events, so the buffered `handle(app)`
 * adapter would collapse every SSE frame into one final body and break the
 * browser-side parser. Keeping streaming in a dedicated entry point lets the
 * rest of the backend stay on the default buffered Lambda proxy contract.
 */
export const handler = streamHandle(app);
