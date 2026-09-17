import { AsyncLocalStorage } from "node:async_hooks";
import type { LambdaEvent } from "hono/aws-lambda";
import { resolveCountryCode } from "./country";

export type RequestCountryLookup = () => Promise<string | null>;

const requestCountryStorage = new AsyncLocalStorage<RequestCountryLookup | null>();

/** Only the Lambda transport installs this context; HTTP headers cannot supply an address. */
export function runWithApiGatewayCountry<Result>(
  event: LambdaEvent,
  callback: () => Promise<Result>,
): Promise<Result> {
  // This exclusion also covers feedback; a marker never authorizes a forwarded address.
  if (Object.keys(event.headers ?? {}).some((name) => name.toLowerCase() === "x-analytics-relay")) {
    return requestCountryStorage.run(null, callback);
  }
  let sourceIp: string | null = null;
  if ("rawPath" in event) {
    sourceIp = event.requestContext.http.sourceIp ?? null;
  } else if ("httpMethod" in event && "identity" in event.requestContext) {
    sourceIp = event.requestContext.identity?.sourceIp ?? null;
  }
  const address = sourceIp;
  const lookup = address === null ? null : () => resolveCountryCode(address);
  return requestCountryStorage.run(lookup, callback);
}

export function getDirectRequestCountryLookup(): RequestCountryLookup | null {
  return requestCountryStorage.getStore() ?? null;
}
