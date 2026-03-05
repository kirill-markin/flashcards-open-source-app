/**
 * Auth service Lambda entry point for API Gateway.
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";

const app = createApp("/auth");

export const handler = handle(app);
