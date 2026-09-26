import { z } from "zod";
import { unsafeTransaction } from "../../database/unsafe";
import { AppleProvider } from "./provider";
import { AppleBillingError, type AppleSigningSecret, type ApplePurchaseIdentity, type AppleNotification } from "./contracts";
import { accountToken, lockPurchase, recordNotification, persistPurchase, finishNotification } from "./store";
import { publishCommittedTransition, type AppleCommittedTransition } from "./facts";

export type AppleBillingService = Readonly<{
  getOrCreateAccountToken: (userId: string) => Promise<Readonly<{ appAccountToken: string }>>;
  attachTransaction: (userId: string, signedTransaction: string) => Promise<Readonly<{ attached: true }>>;
  processNotification: (signedPayload: string) => Promise<void>;
}>;

async function persistCurrentState(
  provider: AppleProvider, identity: ApplePurchaseIdentity, presentingUserId: string | null,
  notification: AppleNotification | null,
): Promise<void> {
  const receivedAt = new Date();
  const outcome = await unsafeTransaction(async (executor): Promise<AppleCommittedTransition | AppleBillingError | null> => {
    const { previous, accounts, ownerUserId } = await lockPurchase(executor, identity, presentingUserId);
    if (notification !== null && await recordNotification(executor, notification, previous, accounts, ownerUserId)) return null;
    // The fetch belongs inside the original-transaction lock, never before it.
    await executor.query("SAVEPOINT apple_purchase", []);
    try {
      const state = await provider.currentState(identity);
      const purchase = await persistPurchase(executor, state, presentingUserId ?? (previous?.user_id == null ? ownerUserId : null), previous, accounts);
      if (notification !== null) await finishNotification(executor, notification.eventId);
      return { previous, purchase, state, receivedAt,
        eventId: notification?.eventId ?? `${state.environment}:${state.transactionId}:${state.signedAt.toISOString()}`,
        affectedUserIds: accounts.map((account) => account.userId) };
    } catch (error) {
      await executor.query("ROLLBACK TO SAVEPOINT apple_purchase", []);
      if (notification === null) throw error;
      const databaseCode = z.object({ code: z.string().regex(/^[A-Z0-9]{5}$/) }).safeParse(error);
      const diagnostic = error instanceof AppleBillingError ? error.message
        : `Apple purchase persistence failed (${databaseCode.success ? databaseCode.data.code : "database boundary error"}); retry delivery.`;
      await executor.query(`UPDATE billing.provider_events SET processing_error = $2
        WHERE provider = 'apple' AND event_id = $1`, [notification.eventId, diagnostic]);
      if (error instanceof AppleBillingError) return error;
      return new AppleBillingError("APPLE_PERSISTENCE_FAILED", true, diagnostic);
    }
  });
  if (outcome instanceof AppleBillingError) throw outcome;
  if (outcome !== null) await publishCommittedTransition(outcome);
}

export function createAppleBillingService(loadSecret: () => Promise<AppleSigningSecret>): AppleBillingService {
  // Instantiating or importing this service never reads secrets or constructs SDK clients.
  const provider = async (): Promise<AppleProvider> => new AppleProvider(await loadSecret());
  return {
    async getOrCreateAccountToken(userId) {
      return { appAccountToken: await unsafeTransaction((executor) => accountToken(executor, userId)) };
    },
    async attachTransaction(userId, signedTransaction) {
      const apple = await provider();
      const identity = await apple.verifyTransaction(signedTransaction);
      await persistCurrentState(apple, identity, userId, null);
      return { attached: true };
    },
    async processNotification(signedPayload) {
      const apple = await provider();
      const notification = await apple.verifyNotification(signedPayload);
      if (notification.identity === null) {
        await unsafeTransaction(async (executor) => {
          if (!await recordNotification(executor, notification, null, [], null)) {
            await finishNotification(executor, notification.eventId);
          }
        });
        return;
      }
      await persistCurrentState(apple, notification.identity, null, notification);
    },
  };
}
