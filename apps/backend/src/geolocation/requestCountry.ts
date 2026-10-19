import { AsyncLocalStorage } from "node:async_hooks";
import type { LambdaEvent } from "hono/aws-lambda";
import { resolveAutonomousSystemNumber } from "./asn";
import { resolveCountryCode } from "./country";

export type RequestCountryLookup = () => Promise<string | null>;
export type RequestNetworkAsnLookup = () => Promise<number | null>;

type DirectRequestSource = Readonly<{
  sourceIp: string;
  countryLookup: RequestCountryLookup;
  networkAsnLookup: RequestNetworkAsnLookup;
}>;

const directRequestSourceStorage = new AsyncLocalStorage<DirectRequestSource | null>();

/** Only the Lambda transport installs this context; HTTP headers cannot supply an address. */
export function runWithApiGatewayCountry<Result>(
  event: LambdaEvent,
  callback: () => Promise<Result>,
): Promise<Result> {
  // This exclusion also covers feedback, the network ASN and the daily visitor hash; a marker never
  // authorizes a forwarded address.
  if (Object.keys(event.headers ?? {}).some((name) => name.toLowerCase() === "x-analytics-relay")) {
    return directRequestSourceStorage.run(null, callback);
  }
  let sourceIp: string | null = null;
  if ("rawPath" in event) {
    sourceIp = event.requestContext.http.sourceIp ?? null;
  } else if ("httpMethod" in event && "identity" in event.requestContext) {
    sourceIp = event.requestContext.identity?.sourceIp ?? null;
  }
  const address = sourceIp;
  const source = address === null
    ? null
    : {
      sourceIp: address,
      countryLookup: () => resolveCountryCode(address),
      networkAsnLookup: () => resolveAutonomousSystemNumber(address),
    };
  return directRequestSourceStorage.run(source, callback);
}

export function getDirectRequestCountryLookup(): RequestCountryLookup | null {
  return directRequestSourceStorage.getStore()?.countryLookup ?? null;
}

export function getDirectRequestNetworkAsnLookup(): RequestNetworkAsnLookup | null {
  return directRequestSourceStorage.getStore()?.networkAsnLookup ?? null;
}

/** The API Gateway source IP of the direct caller, or null off Lambda and on a relayed request. */
export function getDirectRequestSourceIp(): string | null {
  return directRequestSourceStorage.getStore()?.sourceIp ?? null;
}
