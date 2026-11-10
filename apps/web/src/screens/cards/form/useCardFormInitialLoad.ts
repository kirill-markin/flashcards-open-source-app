import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isAuthRedirectError } from "../../../api";
import { isWorkspaceSyncDiscardedError } from "../../../appData/sync/observation/syncErrorObservation";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import type { useI18n } from "../../../i18n";
import { loadCardById } from "../../../localDb/cards/cards";
import { loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { Card, WorkspaceTagsSummary } from "../../../types";

export const workspaceUnavailableErrorMessage = "Workspace is unavailable";

async function runRecoveryGuardedLocalRead<ResultType>(
  createRead: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await createRead();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

export type CardFormIdentity = Readonly<{
  cardId: string | null;
  workspaceId: string | null;
  userId: string | null;
}>;

type InitialSyncOutcome = "completed" | "incomplete";

type InitialSyncAttempt = {
  completion: Promise<InitialSyncOutcome>;
  hasFailed: boolean;
};

export type CardFormLoadOutcome =
  | Readonly<{
    kind: "read";
    tagsSummary: WorkspaceTagsSummary;
    loadedCard: Card | null;
  }>
  | Readonly<{
    kind: "refreshFailed";
    errorMessage: string;
  }>;

/**
 * The screen's side of one local read. `finish` runs only while the read is still current: for
 * every successful read, and for a failed background refresh; blocking failures stay in this hook.
 */
export type CardFormLoadRequest = Readonly<{
  isBackgroundRefresh: boolean;
  finish: (outcome: CardFormLoadOutcome) => void;
}>;

type UseCardFormInitialLoadParams = Readonly<{
  renderedFormIdentity: CardFormIdentity;
  isCreateMode: boolean;
  isSessionVerified: boolean;
  localReadVersion: number;
  requireActiveWorkspaceSync: (workspaceId: string, presentSyncFailure: () => boolean) => Promise<void>;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  showCapturedTechnicalError: (error: unknown) => void;
  observationIdentityRef: RefObject<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>;
  successfulMutationGenerationRef: RefObject<number>;
  t: ReturnType<typeof useI18n>["t"];
  /**
   * Called synchronously at the start of every read. `isLatestLoadRequest` stays true while no
   * newer read has started and the read's form identity is still rendered.
   */
  beginLoadRequest: (isLatestLoadRequest: () => boolean) => CardFormLoadRequest;
}>;

type CardFormInitialLoad = Readonly<{
  isLoading: boolean;
  loadErrorMessage: string;
  retry: () => Promise<void>;
}>;

export function isWorkspaceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === workspaceUnavailableErrorMessage;
}

export function areCardFormIdentitiesEqual(
  left: CardFormIdentity | null,
  right: CardFormIdentity,
): boolean {
  return left !== null
    && left.cardId === right.cardId
    && left.workspaceId === right.workspaceId
    && left.userId === right.userId;
}

export function useCardFormInitialLoad(params: UseCardFormInitialLoadParams): CardFormInitialLoad {
  const {
    renderedFormIdentity,
    isCreateMode,
    isSessionVerified,
    localReadVersion,
    requireActiveWorkspaceSync,
    indexedDbOpenRecoveryState,
    showCapturedTechnicalError,
    observationIdentityRef,
    successfulMutationGenerationRef,
    t,
    beginLoadRequest,
  } = params;
  const renderedFormIdentityRef = useRef<CardFormIdentity | null>(null);
  const [blockingLoadResult, setBlockingLoadResult] = useState<Readonly<{
    identity: CardFormIdentity;
    errorMessage: string;
  }> | null>(null);
  const initialSyncAttemptRef = useRef<InitialSyncAttempt | "required" | null>(null);
  const loadRequestSequenceRef = useRef<number>(0);
  const isLoading = blockingLoadResult?.identity !== renderedFormIdentity;
  const loadErrorMessage = isLoading ? "" : blockingLoadResult.errorMessage;

  const startInitialSync = useCallback(function startInitialSync(workspaceId: string): InitialSyncAttempt {
    const presentSyncFailure = (): boolean => {
      if (
        initialSyncAttemptRef.current !== attempt
        || renderedFormIdentityRef.current !== renderedFormIdentity
      ) {
        return false;
      }

      attempt.hasFailed = true;
      setBlockingLoadResult({ identity: renderedFormIdentity, errorMessage: t("app.syncFailed") });
      return true;
    };
    const attempt: InitialSyncAttempt = {
      completion: requireActiveWorkspaceSync(workspaceId, presentSyncFailure).then(
        () => "completed",
        (error: unknown) => {
          if (
            markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)
            || isWorkspaceSyncDiscardedError(error)
            || isAuthRedirectError(error)
          ) {
            return "incomplete";
          }

          if (attempt.hasFailed === false) {
            presentSyncFailure();
          }
          return "incomplete";
        },
      ),
      hasFailed: false,
    };
    initialSyncAttemptRef.current = attempt;
    return attempt;
  }, [indexedDbOpenRecoveryState, renderedFormIdentity, requireActiveWorkspaceSync, t]);

  const readScreenData = useCallback(async function readScreenData(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestSequence = loadRequestSequenceRef.current + 1;
    loadRequestSequenceRef.current = requestSequence;
    const mutationGeneration = successfulMutationGenerationRef.current;
    const isCurrentLoadRequest = function isCurrentLoadRequest(): boolean {
      return loadRequestSequenceRef.current === requestSequence
        && successfulMutationGenerationRef.current === mutationGeneration
        && renderedFormIdentityRef.current === renderedFormIdentity;
    };
    const loadRequest = beginLoadRequest(function isLatestLoadRequest(): boolean {
      return loadRequestSequenceRef.current === requestSequence
        && areCardFormIdentitiesEqual(renderedFormIdentityRef.current, renderedFormIdentity);
    });
    const isBackgroundRefresh = loadRequest.isBackgroundRefresh;
    const finishBlockingLoad = function finishBlockingLoad(errorMessage: string): void {
      setBlockingLoadResult({ identity: renderedFormIdentity, errorMessage });
    };
    const setCurrentLoadErrorMessage = function setCurrentLoadErrorMessage(
      errorMessage: string,
    ): void {
      if (isBackgroundRefresh) {
        finishBlockingLoad("");
        loadRequest.finish({ kind: "refreshFailed", errorMessage });
      } else {
        finishBlockingLoad(errorMessage);
      }
    };
    const cardId = renderedFormIdentity.cardId;

    try {
      const workspaceId = renderedFormIdentity.workspaceId;
      if (workspaceId === null) {
        throw new Error(workspaceUnavailableErrorMessage);
      }

      const readLocalData = () => Promise.all([
        runRecoveryGuardedLocalRead(
          () => loadWorkspaceTagsSummary(workspaceId),
          indexedDbOpenRecoveryState,
        ),
        runRecoveryGuardedLocalRead(
          () => isCreateMode || cardId === null
            ? Promise.resolve(null)
            : loadCardById(workspaceId, cardId),
          indexedDbOpenRecoveryState,
        ),
      ]);

      const initialSyncAttempt = isBackgroundRefresh ? null : initialSyncAttemptRef.current;
      if (initialSyncAttempt !== null) {
        if (initialSyncAttempt === "required" && isSessionVerified === false) {
          return;
        }

        const attempt = initialSyncAttempt === "required"
          ? startInitialSync(workspaceId)
          : initialSyncAttempt;
        if (
          await attempt.completion !== "completed"
          || isCurrentLoadRequest() === false
          || indexedDbOpenRecoveryState.hasFailed()
        ) {
          return;
        }
      }

      let [tagsSummary, loadedCard] = await readLocalData();
      if (isCurrentLoadRequest() === false) {
        return;
      }

      if (
        loadedCard === null
        && cardId !== null
        && isBackgroundRefresh === false
        && initialSyncAttempt === null
      ) {
        if (isSessionVerified === false) {
          initialSyncAttemptRef.current = "required";
          setBlockingLoadResult(null);
          return;
        }

        if (
          await startInitialSync(workspaceId).completion !== "completed"
          || isCurrentLoadRequest() === false
          || indexedDbOpenRecoveryState.hasFailed()
        ) {
          return;
        }

        [tagsSummary, loadedCard] = await readLocalData();
        if (isCurrentLoadRequest() === false) {
          return;
        }
      }

      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadedCard === null && isCreateMode === false && isBackgroundRefresh) {
        finishBlockingLoad("");
      } else {
        finishBlockingLoad(loadedCard === null && isCreateMode === false ? t("cardForm.errors.cardNotFound") : "");
        if (loadedCard !== null) {
          initialSyncAttemptRef.current = null;
        }
      }
      loadRequest.finish({ kind: "read", tagsSummary, loadedCard });
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isCurrentLoadRequest() === false) {
        return;
      }

      if (isWorkspaceUnavailableError(error)) {
        setCurrentLoadErrorMessage(workspaceUnavailableErrorMessage);
        return;
      }

      const observationIdentity = observationIdentityRef.current;
      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_form_load",
        userId: observationIdentity.userId,
        workspaceId: renderedFormIdentity.workspaceId,
        installationId: observationIdentity.installationId,
        entityId: cardId,
      });
      if (isBackgroundRefresh === false) {
        showCapturedTechnicalError(error);
      }
      setCurrentLoadErrorMessage(t("appError.technicalError.message"));
    }
  }, [
    beginLoadRequest,
    indexedDbOpenRecoveryState,
    isCreateMode,
    isSessionVerified,
    renderedFormIdentity,
    startInitialSync,
    t,
  ]);

  useLayoutEffect(() => {
    renderedFormIdentityRef.current = renderedFormIdentity;
    return () => {
      renderedFormIdentityRef.current = null;
      initialSyncAttemptRef.current = null;
      loadRequestSequenceRef.current += 1;
    };
  }, [renderedFormIdentity]);

  useLayoutEffect(() => {
    const attempt = initialSyncAttemptRef.current;
    if (attempt !== null && attempt !== "required" && attempt.hasFailed === false) {
      initialSyncAttemptRef.current = "required";
    }
    loadRequestSequenceRef.current += 1;
  }, [isSessionVerified]);

  useEffect(() => {
    void readScreenData();
    return () => {
      loadRequestSequenceRef.current += 1;
    };
  }, [readScreenData, localReadVersion]);

  function loadScreenData(): Promise<void> {
    const attempt = initialSyncAttemptRef.current;
    initialSyncAttemptRef.current = attempt !== null && attempt !== "required" && attempt.hasFailed
      ? "required"
      : null;
    if (loadErrorMessage !== "") {
      setBlockingLoadResult(null);
    }
    return readScreenData();
  }

  return {
    isLoading,
    loadErrorMessage,
    retry: loadScreenData,
  };
}
