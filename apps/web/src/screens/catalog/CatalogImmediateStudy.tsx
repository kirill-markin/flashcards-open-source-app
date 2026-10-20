import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { ApiContractError, ApiError, confirmCatalogPackageInstall } from "../../api";
import { reportCatalogInstallFailure, toCatalogInstallFailureReason } from "../../analytics";
import { useAppData } from "../../appData";
import { ALL_CARDS_REVIEW_FILTER } from "../../appData/domain";
import { storeSelectedReviewFilterForWorkspace } from "../../appData/context/reviewFilterPersistence";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { loadCardsByIds } from "../../localDb/cards/cards";
import { loadReviewQueueSnapshot } from "../../localDb/reviews/reviews";
import { buildClientWorkspaceReplicaId } from "../../media/mediaCrypto";
import { buildWorkspaceRoute, reviewRoute } from "../../routes";
import { buildReviewLoadingCardPreview, writeReviewLoadingSnapshot } from "../shared/loadingSnapshots";
import { discardRejectedCatalogImmediateAttempt, readCatalogImmediateAttempt, storeCatalogImmediateAttempt, storeCatalogImmediateStudyLaunch } from "./catalogImmediateAttempt";
import { CatalogImportStatePanel, type CatalogImportContext } from "./catalogImportShared";

export function CatalogImmediateStudy(props: Readonly<{
  catalogContext: CatalogImportContext;
  workspaceId: string;
  onNotEligible: () => void;
}>): ReactElement {
  const { catalogContext, workspaceId } = props;
  const appData = useAppData();
  const currentAppData = useRef(appData);
  currentAppData.current = appData;
  const onNotEligibleRef = useRef(props.onNotEligible);
  onNotEligibleRef.current = props.onNotEligible;
  const { indexedDbOpenRecoveryState, showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [retryRevision, setRetryRevision] = useState(0);
  const [phase, setPhase] = useState<"installing" | "syncing" | "error">("installing");
  const [errorMessage, setErrorMessage] = useState("");
  const { session, activeWorkspace, cloudSettings, isSessionVerified } = appData;
  const identityKey = session !== null && cloudSettings !== null && isSessionVerified
    ? `${session.userId}:${activeWorkspace?.workspaceId ?? ""}:${cloudSettings.installationId}`
    : null;

  useEffect(() => {
    if (identityKey === null || session === null || cloudSettings === null) return;
    let isCurrent = true;
    const userId = session.userId;
    const installationId = cloudSettings.installationId;
    const requireCurrentIdentity = (): void => {
      indexedDbOpenRecoveryState.throwIfFailed();
      const current = currentAppData.current;
      if (!isCurrent || !current.isSessionVerified || current.session?.userId !== userId
        || current.activeWorkspace?.workspaceId !== workspaceId
        || current.cloudSettings?.linkedWorkspaceId !== workspaceId
        || current.cloudSettings.linkedUserId !== userId
        || current.cloudSettings.installationId !== installationId) {
        throw new Error("Catalog onboarding workspace changed. Retry with the original workspace.");
      }
    };
    void (async () => {
      let didCommit = false;
      let isSelectingWorkspace = false;
      try {
        setPhase("installing");
        if (currentAppData.current.activeWorkspace?.workspaceId !== workspaceId) {
          isSelectingWorkspace = true;
          await currentAppData.current.chooseWorkspace(workspaceId);
          requireCurrentIdentity();
          return;
        }
        if (typeof navigator.locks?.request !== "function") {
          throw new Error("Catalog onboarding requires Web Locks to preserve one install request between tabs.");
        }
        await navigator.locks.request(`catalog-immediate-install:${userId}:${catalogContext.packageVersionId}`, async () => {
          requireCurrentIdentity();
          let attempt = readCatalogImmediateAttempt(userId, catalogContext.packageVersionId);
          if (attempt === null) {
            await currentAppData.current.refreshLocalData();
            requireCurrentIdentity();
            const replicaId = await buildClientWorkspaceReplicaId(workspaceId, installationId);
            requireCurrentIdentity();
            const installId = crypto.randomUUID().toLowerCase();
            const installedAt = new Date().toISOString();
            attempt = {
              userId, packageVersionId: catalogContext.packageVersionId, workspaceId, installationId,
              options: {
                immediateOnboarding: true, addImportTag: false, importTag: "", removeTags: [],
                installId, installedAt, clientUpdatedAt: installedAt,
                lastModifiedByReplicaId: replicaId, operationIdPrefix: installId,
              },
            };
            storeCatalogImmediateAttempt(attempt);
          }
          if (attempt.workspaceId !== workspaceId) {
            throw new Error("Saved catalog onboarding request belongs to another workspace. Preserve site data and resume that request.");
          }
          requireCurrentIdentity();
          const requestAttempt = attempt;
          const result = await confirmCatalogPackageInstall(workspaceId, catalogContext.packageVersionId, requestAttempt.options).catch((error: unknown) => {
            if (error instanceof ApiError && error.code === "CATALOG_PACKAGE_INSTALL_ONBOARDING_NOT_ELIGIBLE") {
              discardRejectedCatalogImmediateAttempt(requestAttempt);
              if (isCurrent) onNotEligibleRef.current();
              return null;
            }
            throw error;
          });
          if (result === null) return;
          requireCurrentIdentity();
          if (result.packageVersion.packageVersionId !== catalogContext.packageVersionId
            || result.summary.installId !== attempt.options.installId || result.onboarding === undefined) {
            throw new ApiContractError("catalog immediate install", "result", "matching onboarding install result");
          }
          didCommit = true;
          setPhase("syncing");
          await currentAppData.current.refreshLocalData();
          requireCurrentIdentity();
          const installedIds = result.installedCards.map((card) => card.cardId);
          const localCards = await loadCardsByIds(workspaceId, installedIds);
          requireCurrentIdentity();
          if (installedIds.length === 0 || localCards.size !== installedIds.length
            || [...localCards.values()].some((card) => card.deletedAt !== null)) {
            throw new Error("Catalog onboarding import has not fully hydrated locally. Retry to sync the saved install.");
          }
          const removedDemoCardId = result.onboarding.removedDemoCardId;
          if (removedDemoCardId !== null && (await loadCardsByIds(workspaceId, [removedDemoCardId])).size !== 0) {
            throw new Error("Catalog onboarding demo removal has not hydrated locally. Retry to sync the saved install.");
          }
          const queue = await loadReviewQueueSnapshot(workspaceId, ALL_CARDS_REVIEW_FILTER, 20);
          requireCurrentIdentity();
          const firstCard = queue.cards[0];
          if (firstCard === undefined || !localCards.has(firstCard.cardId)) {
            throw new Error("The imported catalog study card is not ready locally. Retry to sync the saved install.");
          }
          currentAppData.current.selectReviewFilter(ALL_CARDS_REVIEW_FILTER);
          storeSelectedReviewFilterForWorkspace(workspaceId, ALL_CARDS_REVIEW_FILTER);
          writeReviewLoadingSnapshot({
            version: 1, workspaceId, selectedReviewFilterKey: "allCards",
            resolvedReviewFilterTitle: t("filters.allCards"), reviewCounts: queue.reviewCounts,
            currentCard: buildReviewLoadingCardPreview(firstCard),
            queuePreview: queue.cards.map(buildReviewLoadingCardPreview), savedAt: new Date().toISOString(),
          });
          storeCatalogImmediateStudyLaunch(attempt, firstCard.cardId);
          requireCurrentIdentity();
          navigate(buildWorkspaceRoute(workspaceId, reviewRoute), { replace: true });
        });
      } catch (error) {
        if (!isCurrent) return;
        reportCatalogInstallFailure(catalogContext.packageVersionId, didCommit ? "postinstall_sync" : "install", toCatalogInstallFailureReason(error));
        showTechnicalError(error, {
          feature: "settings", operation: "catalog_import", userId, workspaceId,
          installationId, entityId: catalogContext.packageVersionId,
        });
        setErrorMessage(t(isSelectingWorkspace ? "catalogImport.workspaceUnavailable"
          : didCommit ? "catalogImport.syncFailed" : "catalogImport.errorBody"));
        setPhase("error");
      }
    })();
    return () => { isCurrent = false; };
  }, [catalogContext.packageVersionId, identityKey, indexedDbOpenRecoveryState, navigate, retryRevision, showTechnicalError, t, workspaceId]);

  return <CatalogImportStatePanel
    testId={phase === "error" ? "catalog-immediate-error" : "catalog-immediate-loading"}
    title={t(phase === "error" ? "catalogImport.errorTitle" : "catalogImport.title")}
    message={phase === "error" ? errorMessage : t(phase === "syncing" ? "catalogImport.syncing" : "catalogImport.installing")}
    guidance={null}
    retryLabel={phase === "error" ? t("common.retry") : null}
    onRetry={phase === "error" ? () => setRetryRevision((revision) => revision + 1) : null}
  />;
}
