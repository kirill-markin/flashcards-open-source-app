/**
 * Lambda entry point for the dedicated MCP API Gateway on mcp.<domain>; the
 * routes are the app in ../mcp/httpApp.
 */
import { handle } from "hono/aws-lambda";
import { createMcpApp } from "../mcp/httpApp";
import { initializeBackendSentry, wrapBackendHandler } from "../observability/sentry";

initializeBackendSentry("backend-api");

// Sentry.wrapHandler: performs the per-invocation flush before the Lambda
// freezes, so the buffered captureBackendException events of the app's
// onError (and the mcp/server.ts 5xx/unexpected captures) are actually
// delivered. This is the buffered-handler equivalent of lambda.ts:134 and
// matches how lambda.ts delivers buffered events.
export const handler = wrapBackendHandler(handle(createMcpApp()));
