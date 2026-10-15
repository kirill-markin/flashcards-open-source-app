import { AsyncLocalStorage } from "node:async_hooks";
import type { LambdaEvent } from "hono/aws-lambda";
import { AuthAttemptError } from "./attemptContract.js";

const sourceStorage = new AsyncLocalStorage<string | null>();

/** Only transport context supplies rate-limit addresses; forwarded HTTP headers have no authority. */
export function runWithSocialRequestSource<Result>(event: LambdaEvent, callback: () => Promise<Result>): Promise<Result> {
  let source: string | null = null;
  if ("rawPath" in event) source = event.requestContext.http.sourceIp ?? null;
  else if ("httpMethod" in event && "identity" in event.requestContext) source = event.requestContext.identity?.sourceIp ?? null;
  return runWithSocialSourceIp(source, callback);
}

export function getSocialRequestSource(): string {
  const source = sourceStorage.getStore();
  if (source === undefined || source === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return source;
}

export function runWithSocialSourceIp<Result>(source: string | null, callback: () => Promise<Result>): Promise<Result> {
  return sourceStorage.run(source, callback);
}
