/**
 * Auth service Lambda entry point for the dedicated auth API Gateway.
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";

const app = createApp("/v1");

export const handler = handle(app);
