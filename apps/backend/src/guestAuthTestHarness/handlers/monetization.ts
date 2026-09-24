import type pg from "pg";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type UserBillingStateState,
} from "../models";
import { createQueryResult } from "../queryResult";

/**
 * The billing and AI usage rows a guest upgrade moves onto the destination account.
 *
 * The tables carry no per-person row-level security policy, so unlike the feedback and community
 * handlers this one asserts no database scope: the real statements apply none either.
 */

function toNullableString(param: GuestUpgradeExecutorParam): string | null {
  return param === null ? null : String(param);
}

function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function createBillingStateRow<Row extends pg.QueryResultRow>(
  billingState: UserBillingStateState,
): Row {
  return {
    trial_consumed_at: toNullableDate(billingState.trial_consumed_at),
    trial_provider: billingState.trial_provider,
    ever_purchased_at: toNullableDate(billingState.ever_purchased_at),
    stripe_customer_id: billingState.stripe_customer_id,
    apple_app_account_token: billingState.apple_app_account_token,
    google_obfuscated_account_id: billingState.google_obfuscated_account_id,
  } as unknown as Row;
}

export function handleMonetizationExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (text.startsWith("UPDATE billing.purchases SET")) {
    const guestUserId = String(params[0]);
    const targetUserId = String(params[1]);
    state.purchases = state.purchases.map((purchase) => (
      purchase.user_id === guestUserId
        ? { ...purchase, user_id: targetUserId, previous_user_id: guestUserId }
        : purchase
    ));
    return createQueryResult<Row>([]);
  }

  if (text === "UPDATE billing.grants SET user_id = $2 WHERE user_id = $1") {
    const guestUserId = String(params[0]);
    const targetUserId = String(params[1]);
    state.grants = state.grants.map((grant) => (
      grant.user_id === guestUserId ? { ...grant, user_id: targetUserId } : grant
    ));
    return createQueryResult<Row>([]);
  }

  if (text.includes("FROM billing.user_billing_state") && text.endsWith("FOR UPDATE")) {
    const userId = String(params[0]);
    const billingState = state.userBillingState.find((entry) => entry.user_id === userId);
    return createQueryResult<Row>(
      billingState === undefined ? [] : [createBillingStateRow<Row>(billingState)],
    );
  }

  if (text.startsWith("UPDATE billing.user_billing_state SET")) {
    const userId = String(params[0]);
    state.userBillingState = state.userBillingState.map((entry) => (
      entry.user_id === userId
        ? {
          ...entry,
          stripe_customer_id: toNullableString(params[1]),
          apple_app_account_token: toNullableString(params[2]),
          google_obfuscated_account_id: toNullableString(params[3]),
        }
        : entry
    ));
    return createQueryResult<Row>([]);
  }

  if (text.startsWith("INSERT INTO billing.user_billing_state")) {
    const upserted: UserBillingStateState = {
      user_id: String(params[0]),
      trial_consumed_at: toNullableString(params[1]),
      trial_provider: toNullableString(params[2]),
      ever_purchased_at: toNullableString(params[3]),
      stripe_customer_id: toNullableString(params[4]),
      apple_app_account_token: toNullableString(params[5]),
      google_obfuscated_account_id: toNullableString(params[6]),
    };
    const existingIndex = state.userBillingState.findIndex(
      (entry) => entry.user_id === upserted.user_id,
    );
    if (existingIndex === -1) {
      state.userBillingState.push(upserted);
    } else {
      state.userBillingState[existingIndex] = upserted;
    }
    return createQueryResult<Row>([]);
  }

  if (text === "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1") {
    const userId = String(params[0]);
    state.entitlementSnapshots = state.entitlementSnapshots.filter(
      (snapshot) => snapshot.user_id !== userId,
    );
    return createQueryResult<Row>([]);
  }

  if (text.startsWith("UPDATE ai.usage_events SET")) {
    const guestUserId = String(params[0]);
    const guestWorkspaceId = String(params[1]);
    const targetUserId = String(params[2]);
    const targetWorkspaceId = String(params[3]);
    state.aiUsageEvents = state.aiUsageEvents.map((usageEvent) => (
      usageEvent.user_id === guestUserId
        ? {
          ...usageEvent,
          user_id: targetUserId,
          workspace_id: usageEvent.workspace_id === guestWorkspaceId
            ? targetWorkspaceId
            : usageEvent.workspace_id,
        }
        : usageEvent
    ));
    return createQueryResult<Row>([]);
  }

  return null;
}
