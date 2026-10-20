import { loadTranslationCatalog, type TranslationKey } from "../../../i18n/catalog";
import {
  readStoredLocalePreference,
  resolveLocaleState,
  translateMessage,
} from "../../../i18n/runtime";
import { isIndexedDbOpenRecoveryError } from "../../../localDb/core/indexedDbOpenRecovery";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import { nowIso } from "../../domain";
import { isCatalogImportPath } from "../../../routes";
import {
  createOnboardingDemoCardLocally,
  type LocalCardMutationResult,
} from "./syncLocalMutations";

const demoCardTag = "demo";

const demoCardAppName = "**Nibomo**";

function asInlineCode(label: string): string {
  return `\`${label}\``;
}

const demoCardBackKeys: ReadonlyArray<TranslationKey> = [
  "demoCard.back1",
  "demoCard.back2",
  "demoCard.back3",
];

type DemoCardText = Readonly<{
  frontText: string;
  backText: string;
}>;

export type SeedDemoCardInput = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  userId: string;
  workspaceId: string;
  installationId: string;
  isOnlyWorkspaceForUser: boolean;
  remoteIsEmpty: boolean | null;
  localCardCount: number;
}>;

export async function buildDemoCardText(): Promise<DemoCardText> {
  const locale = resolveLocaleState(readStoredLocalePreference()).locale;
  await loadTranslationCatalog(locale);
  const values = {
    appName: demoCardAppName,
    againLabel: asInlineCode(translateMessage(locale, "reviewScreen.ratings.again", undefined)),
  };

  return {
    frontText: translateMessage(locale, "demoCard.front", values),
    backText: demoCardBackKeys.map((key) => translateMessage(locale, key, values)).join("\n\n"),
  };
}

export async function seedDemoCardForNewWorkspace(
  input: SeedDemoCardInput,
): Promise<LocalCardMutationResult | null> {
  input.indexedDbOpenRecoveryState.throwIfFailed();
  if (
    isCatalogImportPath(window.location.pathname)
    || input.isOnlyWorkspaceForUser !== true
    || input.remoteIsEmpty !== true
    || input.localCardCount !== 0
  ) {
    return null;
  }

  try {
    const demoCardText = await buildDemoCardText();
    return await createOnboardingDemoCardLocally(
      {
        workspaceId: input.workspaceId,
        input: {
          frontText: demoCardText.frontText,
          backText: demoCardText.backText,
          tags: [demoCardTag],
        },
        clientUpdatedAt: nowIso(),
      },
      input.indexedDbOpenRecoveryState,
    );
  } catch (error) {
    input.indexedDbOpenRecoveryState.throwIfFailed();
    input.indexedDbOpenRecoveryState.markFailed(error);
    input.indexedDbOpenRecoveryState.throwIfFailed();
    captureAppOperationError(error, {
      feature: "sync",
      operation: "demo_card_seed",
      userId: input.userId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      entityId: null,
    });
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }

    return null;
  }
}
