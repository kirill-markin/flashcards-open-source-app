export type AppleRevocationScheduledEvent = Readonly<{
  version: "0";
  id: string;
  source: "aws.events";
  "detail-type": "Scheduled Event";
  account: string;
  time: string;
  region: string;
  resources: ReadonlyArray<string>;
  detail: Readonly<Record<string, never>>;
}>;

/** Only the native EventBridge envelope of our fixed rule reaches the privileged drain. */
export function isAppleRevocationScheduledEvent(event: object): event is AppleRevocationScheduledEvent {
  if ("requestContext" in event || "httpMethod" in event || "rawPath" in event) return false;
  const value = event as Partial<AppleRevocationScheduledEvent>;
  const ruleArn = process.env.APPLE_REVOCATION_RULE_ARN;
  return ruleArn !== undefined && ruleArn !== "" && value.version === "0" && value.source === "aws.events"
    && value["detail-type"] === "Scheduled Event" && typeof value.id === "string" && value.id.length > 0
    && typeof value.account === "string" && /^\d{12}$/.test(value.account)
    && typeof value.region === "string" && typeof value.time === "string" && Number.isFinite(Date.parse(value.time))
    && Array.isArray(value.resources) && value.resources.length === 1 && value.resources[0] === ruleArn
    && value.detail !== undefined && value.detail !== null && typeof value.detail === "object"
    && !Array.isArray(value.detail) && Object.keys(value.detail).length === 0;
}

export type AppleRevocationWakeEvent = Readonly<{
  source: "nibomo.auth";
  action: "drain-apple-revocations";
  version: 1;
}>;

/** Direct IAM invocation only; no HTTP envelope or caller-selected job/identity is accepted. */
export function isAppleRevocationWakeEvent(event: object): event is AppleRevocationWakeEvent {
  if ("requestContext" in event || "httpMethod" in event || "rawPath" in event || Array.isArray(event)) return false;
  const value = event as Partial<AppleRevocationWakeEvent>;
  return Object.keys(event).length === 3 && value.source === "nibomo.auth"
    && value.action === "drain-apple-revocations" && value.version === 1;
}
