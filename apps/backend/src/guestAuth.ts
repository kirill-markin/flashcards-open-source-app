import { unsafeTransaction } from "./dbUnsafe";
import {
  authenticateGuestSession,
  createGuestSessionInExecutor,
} from "./guestAuth/session";
import {
  completeGuestUpgradeInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./guestAuth/upgrade";
import type {
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./guestAuth/types";

export type {
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./guestAuth/types";

export { authenticateGuestSession, completeGuestUpgradeInExecutor, prepareGuestUpgradeInExecutor };

export async function createGuestSession(): Promise<GuestSessionSnapshot> {
  return unsafeTransaction(async (executor) => createGuestSessionInExecutor(executor));
}

export async function prepareGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  return unsafeTransaction(
    async (executor) => prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, email),
  );
}

export async function completeGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeCompletion> {
  return unsafeTransaction(
    async (executor) => completeGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, selection),
  );
}
