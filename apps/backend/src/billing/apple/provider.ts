import { setTimeout } from "node:timers/promises";
import {
  APIError, APIException, AppStoreServerAPIClient, Environment, SignedDataVerifier,
  VerificationException, VerificationStatus, GetTransactionHistoryVersion, Order, Type, OfferDiscountType, ExpirationIntent, InAppOwnershipType,
  type JWSTransactionDecodedPayload, type JWSRenewalInfoDecodedPayload,
} from "@apple/app-store-server-library";
import { z } from "zod";
import {
  appleTransactionHistorySchema, appleRenewalHistorySchema, type AppleTransactionHistory,
} from "../history/apple";
import { parseHistoryFields } from "../history/store";
import { appleRootCertificates } from "./certificates";
import {
  AppleBillingError, appleAppId, appleBundleId, appleProductId,
  type AppleEnvironment, type AppleNotification, type ApplePurchaseIdentity,
  type ApplePurchaseState, type AppleSigningSecret,
} from "./contracts";

const secretSchema = z.object({ privateKey: z.string().min(1), keyId: z.string().min(1), issuerId: z.uuid() });
const environmentSchema = z.enum(["Production", "Sandbox"]);
const transportFailureSchema = z.object({
  name: z.literal("FetchError"), type: z.enum(["system", "request-timeout", "body-timeout"]),
});
const retryableApiErrors: ReadonlySet<number> = new Set([
  APIError.ACCOUNT_NOT_FOUND_RETRYABLE, APIError.APP_NOT_FOUND_RETRYABLE,
  APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND_RETRYABLE, APIError.GENERAL_INTERNAL_RETRYABLE,
]);
const transactionSchema = z.object({
  originalTransactionId: z.string().min(1), transactionId: z.string().min(1),
  productId: z.literal(appleProductId), bundleId: z.literal(appleBundleId),
  type: z.literal(Type.AUTO_RENEWABLE_SUBSCRIPTION), environment: environmentSchema,
  purchaseDate: z.number().int().nonnegative(), expiresDate: z.number().int().nonnegative(),
  signedDate: z.number().int().nonnegative(), appAccountToken: z.uuid().optional(),
  price: z.number().int().nonnegative().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  transactionReason: z.enum(["PURCHASE", "RENEWAL"]).optional(),
  revocationReason: z.number().int().optional(), inAppOwnershipType: z.string().optional(),
});
type AppleTransaction = JWSTransactionDecodedPayload & z.infer<typeof transactionSchema>;
const renewalSchema = z.object({
  originalTransactionId: z.string().min(1), productId: z.literal(appleProductId),
  environment: environmentSchema, autoRenewStatus: z.union([z.literal(0), z.literal(1)]),
  signedDate: z.number().int().nonnegative(), expirationIntent: z.number().int().optional(),
});

export function parseAppleSigningSecret(json: string): AppleSigningSecret {
  try {
    return secretSchema.parse(JSON.parse(json));
  } catch {
    throw new AppleBillingError("APPLE_CONFIGURATION_INVALID", false,
      "Apple signing secret must contain privateKey, keyId and a UUID issuerId.");
  }
}

function requireValue<Value>(value: Value | undefined, field: string): Value {
  if (value === undefined) {
    throw new AppleBillingError("APPLE_RESPONSE_INVALID", false, `Apple response is missing ${field}.`);
  }
  return value;
}

function toEnvironment(environment: string): AppleEnvironment {
  if (environment === Environment.PRODUCTION) return "production";
  if (environment === Environment.SANDBOX) return "sandbox";
  throw new AppleBillingError("APPLE_ENVIRONMENT_INVALID", false, "Only Apple production and sandbox are accepted.");
}

function selectEnvironment(signed: string): AppleEnvironment {
  // This untrusted hint selects a verifier only. No decoded field crosses this boundary.
  try {
    const payload = z.object({
      environment: environmentSchema.optional(),
      data: z.object({ environment: environmentSchema }).optional(),
      summary: z.object({ environment: environmentSchema }).optional(),
    }).parse(JSON.parse(Buffer.from(signed.split(".")[1], "base64url").toString("utf8")));
    return toEnvironment(requireValue(payload.environment ?? payload.data?.environment ?? payload.summary?.environment, "environment"));
  } catch {
    throw new AppleBillingError("APPLE_PAYLOAD_INVALID", false, "Apple JWS has no supported environment.");
  }
}

async function callApple<Result>(operation: string, callback: () => Promise<Result>): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await callback();
    } catch (error) {
      const transportFailure = transportFailureSchema.safeParse(error);
      const retryable = error instanceof APIException
        ? error.httpStatusCode === 429 || error.httpStatusCode >= 500
          || (error.apiError !== null && retryableApiErrors.has(error.apiError))
        : error instanceof VerificationException
          ? error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
          : transportFailure.success || error instanceof TypeError;
      const diagnostic = error instanceof APIException
        ? `HTTP ${error.httpStatusCode}, Apple code ${error.apiError}`
        : error instanceof VerificationException ? `verification status ${error.status}`
          : transportFailure.success ? `FetchError (${transportFailure.data.type})` : "transport or SDK failure";
      if (!retryable || attempt >= 3) {
        throw new AppleBillingError("APPLE_PROVIDER_FAILED", retryable, `Apple ${operation} failed: ${diagnostic}.`);
      }
      console.warn(JSON.stringify({ event: "apple_provider_retry", operation, attempt, diagnostic }));
      await setTimeout(attempt * 200);
    }
  }
}

export class AppleProvider {
  private readonly clients: Record<AppleEnvironment, AppStoreServerAPIClient>;
  private readonly verifiers: Record<AppleEnvironment, SignedDataVerifier>;

  constructor(secret: AppleSigningSecret) {
    const roots = appleRootCertificates.map((certificate) => Buffer.from(certificate, "base64"));
    const createClient = (environment: Environment): AppStoreServerAPIClient => new AppStoreServerAPIClient(
      secret.privateKey, secret.keyId, secret.issuerId, appleBundleId, environment,
    );
    const createVerifier = (environment: Environment): SignedDataVerifier => new SignedDataVerifier(
      roots, true, environment, appleBundleId, appleAppId,
    );
    this.clients = { production: createClient(Environment.PRODUCTION), sandbox: createClient(Environment.SANDBOX) };
    this.verifiers = { production: createVerifier(Environment.PRODUCTION), sandbox: createVerifier(Environment.SANDBOX) };
  }

  private async transaction(signed: string, environment: AppleEnvironment): Promise<AppleTransaction> {
    const decoded = await callApple("verify transaction", () => this.verifiers[environment].verifyAndDecodeTransaction(signed));
    const transaction = transactionSchema.safeParse(decoded);
    if (!transaction.success) {
      throw new AppleBillingError("APPLE_TRANSACTION_INVALID", false, "Apple transaction must be a complete premium_monthly subscription.");
    }
    // A spread optional field widens back to the SDK's string, so the narrowed reason is set explicitly.
    return { ...decoded, ...transaction.data, transactionReason: transaction.data.transactionReason };
  }

  private async renewal(signed: string, identity: ApplePurchaseIdentity): Promise<JWSRenewalInfoDecodedPayload & z.infer<typeof renewalSchema>> {
    const decoded = await callApple("verify renewal", () => this.verifiers[identity.environment].verifyAndDecodeRenewalInfo(signed));
    const renewal = renewalSchema.safeParse(decoded);
    if (!renewal.success || decoded.originalTransactionId !== identity.originalTransactionId) {
      throw new AppleBillingError("APPLE_RENEWAL_INVALID", false, "Apple renewal does not match this premium_monthly purchase.");
    }
    return { ...decoded, ...renewal.data };
  }

  async verifyTransaction(signed: string): Promise<ApplePurchaseIdentity> {
    const environment = selectEnvironment(signed);
    const decoded = await this.transaction(signed, environment);
    return { environment, originalTransactionId: requireValue(decoded.originalTransactionId, "originalTransactionId"),
      appAccountToken: decoded.appAccountToken ?? null };
  }

  async verifyNotification(signedPayload: string): Promise<AppleNotification> {
    const environment = selectEnvironment(signedPayload);
    const decoded = await callApple("verify notification", () => this.verifiers[environment].verifyAndDecodeNotification(signedPayload));
    const eventId = requireValue(decoded.notificationUUID, "notificationUUID");
    if (!z.uuid().safeParse(eventId).success || decoded.version !== "2.0") {
      throw new AppleBillingError("APPLE_NOTIFICATION_INVALID", false, "Apple notification must have a UUID and version 2.0.");
    }
    const signedTransaction = decoded.data?.signedTransactionInfo;
    const transaction = signedTransaction === undefined ? null : await this.transaction(signedTransaction, environment);
    const identity = transaction === null ? null : {
      environment, originalTransactionId: requireValue(transaction.originalTransactionId, "originalTransactionId"),
      appAccountToken: transaction.appAccountToken ?? null,
    };
    let renewalInfo: z.infer<typeof appleRenewalHistorySchema> | undefined;
    if (decoded.data?.signedRenewalInfo !== undefined) {
      if (identity === null) throw new AppleBillingError("APPLE_NOTIFICATION_INVALID", false, "Apple renewal has no transaction identity.");
      renewalInfo = parseHistoryFields(appleRenewalHistorySchema, await this.renewal(decoded.data.signedRenewalInfo, identity));
    }
    const eventType = requireValue(decoded.notificationType, "notificationType");
    if (identity === null && eventType !== "TEST") {
      throw new AppleBillingError("APPLE_NOTIFICATION_UNSUPPORTED", false, "Apple notification has no subscription transaction.");
    }
    return { eventId, eventType, environment, identity, signedPayload,
      historyTransaction: transaction === null ? undefined
        : parseHistoryFields(appleTransactionHistorySchema, { ...transaction, renewalInfo }),
      occurredAt: new Date(requireValue(decoded.signedDate, "signedDate")) };
  }

  async transactionHistoryPage(
    environment: AppleEnvironment, originalTransactionId: string, revision: string | null,
    from: Date, to: Date,
  ): Promise<Readonly<{ transactions: ReadonlyArray<AppleTransactionHistory>; revision: string; hasMore: boolean }>> {
    const response = await callApple("getTransactionHistory", () => this.clients[environment].getTransactionHistory(
      originalTransactionId, revision, {
        startDate: from.getTime(), endDate: to.getTime(), productIds: [appleProductId], sort: Order.ASCENDING,
      }, GetTransactionHistoryVersion.V2));
    if (response.bundleId !== appleBundleId || toEnvironment(requireValue(response.environment, "environment")) !== environment
      || (environment === "production" && response.appAppleId !== appleAppId)) {
      throw new AppleBillingError("APPLE_HISTORY_IDENTITY_INVALID", false, "Apple history identifies another app or environment.");
    }
    const nextRevision = requireValue(response.revision, "revision");
    const hasMore = requireValue(response.hasMore, "hasMore");
    if (hasMore && (nextRevision === "" || nextRevision === revision)) {
      throw new AppleBillingError("APPLE_HISTORY_PAGINATION_INVALID", false, "Apple history revision did not advance.");
    }
    const transactions: Array<AppleTransactionHistory> = [];
    for (const signed of requireValue(response.signedTransactions, "signedTransactions")) {
      transactions.push(parseHistoryFields(appleTransactionHistorySchema, await this.transaction(signed, environment)));
    }
    return { transactions, revision: nextRevision, hasMore };
  }

  async notificationHistoryPage(
    environment: AppleEnvironment, paginationToken: string | null, from: Date, to: Date,
  ): Promise<Readonly<{ transactions: ReadonlyArray<AppleTransactionHistory>; paginationToken: string | null; hasMore: boolean }>> {
    const response = await callApple("getNotificationHistory", () => this.clients[environment].getNotificationHistory(
      paginationToken, { startDate: from.getTime(), endDate: to.getTime(), onlyFailures: false }));
    const hasMore = requireValue(response.hasMore, "hasMore");
    const nextToken = response.paginationToken ?? null;
    if (hasMore && (nextToken === null || nextToken === "" || nextToken === paginationToken)) {
      throw new AppleBillingError("APPLE_HISTORY_PAGINATION_INVALID", false, "Apple notification history token did not advance.");
    }
    const transactions: Array<AppleTransactionHistory> = [];
    for (const item of requireValue(response.notificationHistory, "notificationHistory")) {
      const signed = requireValue(item.signedPayload, "signedPayload");
      const decoded = await callApple("verify history notification", () => this.verifiers[environment].verifyAndDecodeNotification(signed));
      if (!z.uuid().safeParse(decoded.notificationUUID).success || decoded.version !== "2.0"
        || !z.number().int().nonnegative().safeParse(decoded.signedDate).success) {
        throw new AppleBillingError("APPLE_NOTIFICATION_INVALID", false, "Apple history notification has invalid identity or signing time.");
      }
      if (decoded.data?.signedTransactionInfo !== undefined) {
        const transaction = await this.transaction(decoded.data.signedTransactionInfo, environment);
        const renewalInfo = decoded.data.signedRenewalInfo === undefined ? undefined
          : parseHistoryFields(appleRenewalHistorySchema, await this.renewal(decoded.data.signedRenewalInfo, {
            environment, originalTransactionId: transaction.originalTransactionId, appAccountToken: null,
          }));
        transactions.push(parseHistoryFields(appleTransactionHistorySchema, { ...transaction, renewalInfo }));
      }
    }
    return { transactions, paginationToken: nextToken, hasMore };
  }

  async currentHistoryTransaction(
    environment: AppleEnvironment, originalTransactionId: string,
  ): Promise<AppleTransactionHistory> {
    const response = await callApple("getAllSubscriptionStatuses history", () =>
      this.clients[environment].getAllSubscriptionStatuses(originalTransactionId));
    if (response.bundleId !== appleBundleId || toEnvironment(requireValue(response.environment, "environment")) !== environment
      || (environment === "production" && response.appAppleId !== appleAppId)) {
      throw new AppleBillingError("APPLE_HISTORY_IDENTITY_INVALID", false, "Apple status history identifies another app or environment.");
    }
    const items = (response.data ?? []).flatMap((group) => group.lastTransactions ?? [])
      .filter((item) => item.originalTransactionId === originalTransactionId);
    if (items.length !== 1) {
      throw new AppleBillingError("APPLE_STATUS_MISSING", true, "Apple history did not return exactly one current status.");
    }
    const transaction = await this.transaction(requireValue(items[0].signedTransactionInfo, "signedTransactionInfo"), environment);
    const renewalInfo = parseHistoryFields(appleRenewalHistorySchema, await this.renewal(
      requireValue(items[0].signedRenewalInfo, "signedRenewalInfo"), { environment, originalTransactionId, appAccountToken: null }));
    if (transaction.originalTransactionId !== originalTransactionId) {
      throw new AppleBillingError("APPLE_IDENTITY_MISMATCH", false, "Apple history status identifies another original transaction.");
    }
    return parseHistoryFields(appleTransactionHistorySchema, { ...transaction, renewalInfo });
  }

  async currentState(identity: ApplePurchaseIdentity): Promise<ApplePurchaseState> {
    const response = await callApple("getAllSubscriptionStatuses", () =>
      this.clients[identity.environment].getAllSubscriptionStatuses(identity.originalTransactionId));
    if (response.bundleId !== appleBundleId || toEnvironment(requireValue(response.environment, "environment")) !== identity.environment
      || (identity.environment === "production" && response.appAppleId !== appleAppId)) {
      throw new AppleBillingError("APPLE_RESPONSE_INVALID", false, "Apple subscription response identifies another app or environment.");
    }
    const candidates = (response.data ?? []).flatMap((group) => group.lastTransactions ?? [])
      .filter((item) => item.originalTransactionId === identity.originalTransactionId);
    if (candidates.length !== 1) throw new AppleBillingError("APPLE_STATUS_MISSING", true, "Apple did not return exactly one current subscription status.");
    const item = candidates[0];
    const transaction = await this.transaction(requireValue(item.signedTransactionInfo, "signedTransactionInfo"), identity.environment);
    const renewal = await this.renewal(requireValue(item.signedRenewalInfo, "signedRenewalInfo"), identity);
    if (transaction.originalTransactionId !== identity.originalTransactionId) {
      throw new AppleBillingError("APPLE_IDENTITY_MISMATCH", false, "Apple status transaction identifies another purchase.");
    }
    // Billing retry (3) has ended access although Apple may still recover the charge; billing grace (4) has not.
    const statuses = { 1: "active", 2: "expired", 3: "expired", 4: "in_grace", 5: "revoked" } as const;
    const status = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).safeParse(item.status);
    if (!status.success) throw new AppleBillingError("APPLE_STATUS_INVALID", false, "Apple returned an unsupported subscription status.");
    const isTrial = transaction.offerDiscountType === OfferDiscountType.FREE_TRIAL;
    return {
      ...identity, transactionId: requireValue(transaction.transactionId, "transactionId"), productId: transaction.productId,
      // Apple reports milliunits of the currency.
      price: transaction.price === undefined || transaction.currency === undefined ? null
        : { amountMicros: transaction.price * 1000, currency: transaction.currency },
      transactionReason: transaction.transactionReason ?? null,
      status: statuses[status.data], providerStatus: String(status.data), isTrial,
      willRenew: renewal.autoRenewStatus === 1,
      autorenewDisabledReason: renewal.expirationIntent === ExpirationIntent.BILLING_ERROR ? "billing_error" : "voluntary",
      revokedReason: status.data !== 5 ? null : transaction.revocationReason !== undefined ? "refund"
        : transaction.inAppOwnershipType === InAppOwnershipType.FAMILY_SHARED ? "family_removal" : "unknown",
      until: new Date(requireValue(transaction.expiresDate, "expiresDate")),
      graceUntil: status.data === 4 ? new Date(requireValue(renewal.gracePeriodExpiresDate, "gracePeriodExpiresDate")) : null,
      purchasedAt: new Date(requireValue(transaction.purchaseDate, "purchaseDate")),
      signedAt: new Date(Math.max(requireValue(transaction.signedDate, "signedDate"), requireValue(renewal.signedDate, "signedDate"))),
      revokedAt: transaction.revocationDate === undefined ? null : new Date(transaction.revocationDate),
      paid: !isTrial && transaction.price !== undefined && transaction.price > 0,
    };
  }
}
