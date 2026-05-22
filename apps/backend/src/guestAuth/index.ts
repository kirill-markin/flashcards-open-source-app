import { unsafeTransaction } from "../database/unsafe";
import {
  deleteGuestSessionInExecutor,
} from "./delete";
import {
  authenticateGuestSession,
  createGuestSessionInExecutor,
} from "./session";
import {
  completeGuestUpgradeInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./upgrade";
import type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export {
  authenticateGuestSession,
  completeGuestUpgradeInExecutor,
  deleteGuestSessionInExecutor,
  prepareGuestUpgradeInExecutor,
};

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
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  return unsafeTransaction(
    async (executor) => completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      cognitoSubject,
      selection,
      capabilities,
    ),
  );
}

export async function deleteGuestSession(guestToken: string): Promise<void> {
  return unsafeTransaction(async (executor) => deleteGuestSessionInExecutor(executor, guestToken));
}
