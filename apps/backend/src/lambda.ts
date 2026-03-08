import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp("");

/**
 * Keeps the default buffered Lambda proxy behavior for the main backend
 * routes such as `/health`, `/cards`, and `/decks`.
 *
 * Those endpoints return complete JSON payloads, so streaming would add no
 * benefit and would make API Gateway treat every route as a streaming
 * integration. The chat SSE path uses the sibling `lambda-stream.ts` entry
 * point instead.
 */
export const handler = handle(app);
