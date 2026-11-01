import * as Sentry from "@sentry/aws-serverless";
import type { Context } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { completeLambdaInvocation, initializeAuthSentry, runLambdaInvocation } from "./server/sentry.js";
import { createApp } from "./app.js";
import { runWithSocialRequestSource } from "./server/social/requestSource.js";
import { drainAppleRevocations } from "./server/social/appleLifecycle.js";
import {
  isAppleRevocationScheduledEvent, isAppleRevocationWakeEvent,
  type AppleRevocationScheduledEvent, type AppleRevocationWakeEvent,
} from "./server/social/appleRevocationEvent.js";

initializeAuthSentry();

const app = createApp("/v1");
const httpHandler = handle(app);

type HttpEvent = Parameters<typeof httpHandler>[0];
type LambdaContext = Context;

const authHandler = async (event: HttpEvent | AppleRevocationScheduledEvent | AppleRevocationWakeEvent, context: LambdaContext) => {
  if (event !== null && typeof event === "object"
    && (isAppleRevocationScheduledEvent(event) || isAppleRevocationWakeEvent(event))) {
    return drainAppleRevocations(context.awsRequestId, () => context.getRemainingTimeInMillis());
  }
  if (event === null || typeof event !== "object" || !("requestContext" in event)) {
    throw new Error("Unsupported auth Lambda event; expected API Gateway request, the configured revocation schedule, or an internal cleanup wake");
  }
  return runWithSocialRequestSource(event as HttpEvent, () => httpHandler(event as HttpEvent, context));
};

export const handler = (event: HttpEvent | AppleRevocationScheduledEvent | AppleRevocationWakeEvent, context: LambdaContext) =>
  runLambdaInvocation(event, context, (span) => Sentry.wrapHandler(
    (invocationEvent: typeof event, invocationContext) =>
      completeLambdaInvocation(span, () => authHandler(invocationEvent, invocationContext)),
  )(event, context, () => {}));
