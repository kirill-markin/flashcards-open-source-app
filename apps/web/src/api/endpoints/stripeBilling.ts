import {
  parsePublicRegionalOffer, type PublicRegionalOffer, parseStripeCheckout, parseStripeCheckoutReturn, parseStripeDetails, parseStripeOffer, parseStripePortal,
  type StripeCheckout, type StripeCheckoutReturn, type StripeDetails, type StripeOffer,
} from "../../apiContracts/stripeBilling";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecoveryWithTransientNetworkRetry, requestCredentialFreeJson, skipAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

export type StripeRequestIdentity = Readonly<{ userId: string; signal: AbortSignal }>;

export async function loadStripeOffer(identity: StripeRequestIdentity, country: string | null): Promise<StripeOffer> {
  return parseContractResponse(await requestJson(`/billing/stripe/offer${country === null ? "" : `?country=${encodeURIComponent(country)}`}`, {
    method: "GET", cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "GET /billing/stripe/offer", (value, endpoint) => parseStripeOffer(value, endpoint, ""));
}

export async function loadStripeSubscriptions(identity: StripeRequestIdentity, country: string | null): Promise<StripeDetails> {
  return parseContractResponse(await requestJson(`/billing/stripe/subscriptions${country === null ? "" : `?country=${encodeURIComponent(country)}`}`, {
    method: "GET", cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "GET /billing/stripe/subscriptions", (value, endpoint) => parseStripeDetails(value, endpoint, ""));
}

export async function createStripeCheckout(identity: StripeRequestIdentity, country: string | null): Promise<StripeCheckout> {
  return parseContractResponse(await requestJson("/billing/stripe/checkout", {
    method: "POST", body: JSON.stringify(country === null ? {} : { country }), cache: "no-store", signal: identity.signal,
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

export async function loadPublicRegionalOffer(country: string | null, signal: AbortSignal): Promise<PublicRegionalOffer> {
  const path = `/billing/regional-offer${country === null ? "" : `?country=${encodeURIComponent(country)}`}`;
  return parseContractResponse(await requestCredentialFreeJson(path, { method: "GET", cache: "no-store", signal },
    skipAuthRecoveryWithTransientNetworkRetry), "GET /billing/regional-offer", (value, endpoint) => parsePublicRegionalOffer(value, endpoint, ""));
}

export async function requoteStripeCheckout(identity: StripeRequestIdentity, attemptId: string, country: string): Promise<StripeCheckout> {
  return parseContractResponse(await requestJson("/billing/stripe/checkout/requote", {
    method: "POST", body: JSON.stringify({ attemptId, country }), cache: "no-store", signal: identity.signal,
  }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: identity.userId }), "POST /billing/stripe/checkout/requote", (value, endpoint) => parseStripeCheckout(value, endpoint, ""));
}
