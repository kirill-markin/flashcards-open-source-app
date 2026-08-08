import { handle } from "hono/aws-lambda";
import { createDirectImageIngestionApp } from "../server/mediaRequests/directImageIngestionApp";
import { getAllowedBrowserOrigins } from "../server/browserCors";
import { createDirectImageIngestionLambdaHandler } from "./directImageIngestionLambdaHandler";

const handleRequest = handle(createDirectImageIngestionApp());

export const handler = createDirectImageIngestionLambdaHandler({
  allowedOriginsFn: getAllowedBrowserOrigins,
  handleRequestFn: handleRequest,
  nowFn: Date.now,
});
