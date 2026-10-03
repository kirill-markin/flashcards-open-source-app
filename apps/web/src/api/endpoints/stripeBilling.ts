import {
  parseStripeCheckout, parseStripeCheckoutReturn, parseStripeDetails, parseStripeOffer, parseStripePortal,
  type StripeCheckout, type StripeCheckoutReturn, type StripeDetails, type StripeOffer,
} from "../../apiContracts/stripeBilling";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

export type StripeRequestIdentity = Readonly<{ userId: string; signal: AbortSignal }>;

export async function loadStripeOffer(identity: StripeRequestIdentity): Promise<StripeOffer> {
  return parseContractResponse(await requestJson("/billing/stripe/offer", {
    method: "GET", cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "GET /billing/stripe/offer", (value, endpoint) => parseStripeOffer(value, endpoint, ""));
}

export async function loadStripeSubscriptions(identity: StripeRequestIdentity): Promise<StripeDetails> {
  return parseContractResponse(await requestJson("/billing/stripe/subscriptions", {
    method: "GET", cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "GET /billing/stripe/subscriptions", (value, endpoint) => parseStripeDetails(value, endpoint, ""));
}

export async function createStripeCheckout(identity: StripeRequestIdentity): Promise<StripeCheckout> {
  return parseContractResponse(await requestJson("/billing/stripe/checkout", {
    method: "POST", body: JSON.stringify({}), cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "POST /billing/stripe/checkout", (value, endpoint) => parseStripeCheckout(value, endpoint, ""));
}

export async function createStripePortal(identity: StripeRequestIdentity, identityId: string): Promise<Readonly<{ url: string }>> {
  return parseContractResponse(await requestJson("/billing/stripe/portal", {
    method: "POST", body: JSON.stringify({ identityId }), cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "POST /billing/stripe/portal", (value, endpoint) => parseStripePortal(value, endpoint, ""));
}

export async function reconcileStripeCheckoutReturn(
  identity: StripeRequestIdentity, attemptId: string, sessionId: string,
): Promise<StripeCheckoutReturn> {
  return parseContractResponse(await requestJson("/billing/stripe/checkout/return", {
    method: "POST", body: JSON.stringify({ attemptId, sessionId }), cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "POST /billing/stripe/checkout/return", (value, endpoint) => parseStripeCheckoutReturn(value, endpoint, ""));
}
