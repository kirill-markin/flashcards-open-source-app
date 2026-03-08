import { streamHandle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp("");

/**
 * Uses Lambda response streaming so the chat SSE endpoint can reach API Gateway
 * without being flattened into a single buffered payload.
 */
export const handler = streamHandle(app);
