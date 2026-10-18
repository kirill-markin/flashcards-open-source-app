import { parsePaywallState, type PaywallShownInput, type PaywallState } from "../../apiContracts/paywallState";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

type PaywallRequestIdentity = Readonly<{ userId: string; signal: AbortSignal }>;

export async function loadPaywallState(identity: PaywallRequestIdentity): Promise<PaywallState> {
  return parseContractResponse(await requestJson("/me/paywall-state", {
    method: "GET", cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }),
  "GET /me/paywall-state", (value, endpoint) => parsePaywallState(value, endpoint, ""));
}

export async function recordPaywallShown(identity: PaywallRequestIdentity, input: PaywallShownInput): Promise<PaywallState> {
  return parseContractResponse(await requestJson("/me/paywall-shown", {
    method: "POST", body: JSON.stringify(input), cache: "no-store", keepalive: true, signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }),
  "POST /me/paywall-shown", (value, endpoint) => parsePaywallState(value, endpoint, ""));
}
