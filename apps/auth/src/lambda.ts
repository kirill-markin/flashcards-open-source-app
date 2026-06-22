/**
 * Auth service Lambda entry point for the dedicated auth API Gateway.
 */
import * as Sentry from "@sentry/aws-serverless";
import { handle } from "hono/aws-lambda";
import { initializeAuthSentry } from "./server/sentry.js";
import { createApp } from "./app.js";

initializeAuthSentry();

const app = createApp("/v1");

export const handler = Sentry.wrapHandler(handle(app));
