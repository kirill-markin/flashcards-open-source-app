import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp("");

export const handler = handle(app);
