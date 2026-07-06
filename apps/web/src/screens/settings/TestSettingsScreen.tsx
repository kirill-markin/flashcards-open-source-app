import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../../appData";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import {
  settingsTestAnimationsRoute,
  settingsTestLocalSyncDiagnosticsRoute,
} from "../../routes";
import {
  loadLocalSyncDiagnosticsReport,
  type LocalSyncDiagnosticsReport,
} from "../../localDb/diagnostics/localSyncDiagnostics";
import {
  MobileAppPromotionDialog,
  webReviewMobilePromptStoreLinks,
} from "../review/mobileAppPromo/MobileAppPromotionDialog";
import {
  appendReviewReactionEvent,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reviewReactionRatings,
  reviewReactionVariantProbabilityPercent,
  reviewReactionVariantDistributionEntries,
  reducedReviewReactionMotionMediaQuery,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
  type ReviewReactionRating,
  type ReviewReactionRenderableVariant,
  type ReviewReactionVariantDistributionEntry,
} from "../review/reactions/reviewReaction";
import { ReviewRatingReactionLayer } from "../review/reactions/ReviewRatingReactionLayer";
import {
  isReviewReactionLottieVariant,
  loadReviewReactionLottieAsset,
  releaseReviewReactionLottieRender,
  reserveReviewReactionLottieRender,
  reviewReactionLottieFallbackVariant,
  startReviewReactionLottiePrewarm,
} from "../review/reactions/lottie/reviewReactionLottie";
import { SettingsActionCard, SettingsGroup, SettingsNavigationCard, SettingsShell } from "./SettingsShared";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type FormatNumber = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
type DiagnosticDisplayValue = string | number | boolean | null;

type DiagnosticField = Readonly<{
  labelKey: TranslationKey;
  value: DiagnosticDisplayValue;
}>;

type DiagnosticFieldGridProps = Readonly<{
  fields: ReadonlyArray<DiagnosticField>;
  formatNumber: FormatNumber;
  t: Translate;
}>;

type ProblemRecordSectionProps = Readonly<{
  title: string;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}>;

const probabilityFormatOptions: Readonly<Intl.NumberFormatOptions> = {
  maximumFractionDigits: 0,
};

export function TestSettingsScreen(): ReactElement {
  const { t } = useI18n();
  const { showTechnicalErrorPreview } = useAppErrorDialog();
  const [isMobileAppPromotionDialogOpen, setIsMobileAppPromotionDialogOpen] = useState<boolean>(false);

  return (
    <SettingsShell
      title={t("settingsTest.title")}
      subtitle={t("settingsTest.subtitle")}
      activeTab="test"
    >
      <div data-testid="test-settings-screen">
        <SettingsGroup title={t("settingsTest.toolsGroupTitle")}>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsTest.animations.title")}
              description={t("settingsTest.animations.description")}
              value={t("settingsTest.animations.value")}
              to={settingsTestAnimationsRoute}
              testId="test-settings-animations-row"
            />
            <SettingsNavigationCard
              title={t("settingsTest.localSyncDiagnostics.title")}
              description={t("settingsTest.localSyncDiagnostics.description")}
              value={t("settingsTest.localSyncDiagnostics.value")}
              to={settingsTestLocalSyncDiagnosticsRoute}
              testId="test-settings-local-sync-diagnostics-row"
            />
            <SettingsActionCard
              title={t("settingsTest.technicalError.title")}
              description={t("settingsTest.technicalError.description")}
              value={t("settingsTest.technicalError.value")}
              onClick={showTechnicalErrorPreview}
              testId="test-settings-technical-error-row"
            />
            <SettingsActionCard
              title={t("settingsTest.mobileAppPromo.title")}
              description={t("settingsTest.mobileAppPromo.description")}
              value={t("settingsTest.mobileAppPromo.value")}
              onClick={() => setIsMobileAppPromotionDialogOpen(true)}
              testId="test-settings-mobile-app-promo-row"
            />
          </div>
        </SettingsGroup>
      </div>
      <MobileAppPromotionDialog
        isOpen={isMobileAppPromotionDialogOpen}
        onDismiss={() => setIsMobileAppPromotionDialogOpen(false)}
        storeLinks={webReviewMobilePromptStoreLinks}
      />
    </SettingsShell>
  );
}

function formatDiagnosticDisplayValue(
  value: DiagnosticDisplayValue,
  formatNumber: FormatNumber,
  t: Translate,
): string {
  if (value === null) {
    return t("settingsTest.localSyncDiagnostics.unavailable");
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return value.trim() === "" ? t("settingsTest.localSyncDiagnostics.unavailable") : value;
}

function DiagnosticFieldGrid(props: DiagnosticFieldGridProps): ReactElement {
  const { fields, formatNumber, t } = props;

  return (
    <dl className="settings-diagnostics-field-grid">
      {fields.map((field) => (
        <div className="settings-diagnostics-field" key={field.labelKey}>
          <dt>{t(field.labelKey)}</dt>
          <dd>{formatDiagnosticDisplayValue(field.value, formatNumber, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProblemRecordSection(props: ProblemRecordSectionProps): ReactElement {
  const { title, isEmpty, emptyMessage, children } = props;

  return (
    <section className="settings-diagnostics-problem-section">
      <h3 className="settings-diagnostics-problem-title">{title}</h3>
      {isEmpty ? <p className="subtitle settings-diagnostics-empty">{emptyMessage}</p> : children}
    </section>
  );
}

function buildCardsSyncFields(report: LocalSyncDiagnosticsReport): ReadonlyArray<DiagnosticField> {
  return [
    { labelKey: "settingsTest.localSyncDiagnostics.fields.workspaceId", value: report.cardsSync.workspaceId },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.installationId", value: report.cardsSync.installationId },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.cloudState", value: report.cardsSync.cloudState },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.localActiveCards", value: report.cardsSync.localActiveCards },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.localDeletedCards", value: report.cardsSync.localDeletedCards },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.pendingCardOperations", value: report.cardsSync.pendingCardOperations },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.failedCardOperations", value: report.cardsSync.failedCardOperations },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.oldestPendingCardOperation", value: report.cardsSync.oldestPendingCardOperation },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.latestCardSyncSuccess", value: report.cardsSync.latestCardSyncSuccess },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.hotStateHydrated", value: report.cardsSync.hotStateHydrated },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.hotCursor", value: report.cardsSync.hotCursor },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.reviewCursor", value: report.cardsSync.reviewCursor },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.latestSyncError", value: report.cardsSync.latestSyncError },
  ];
}

function buildManagedMediaSyncFields(report: LocalSyncDiagnosticsReport): ReadonlyArray<DiagnosticField> {
  return [
    { labelKey: "settingsTest.localSyncDiagnostics.fields.localActiveMediaAssets", value: report.managedMediaSync.localActiveMediaAssets },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.deletedMediaAssets", value: report.managedMediaSync.deletedMediaAssets },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.localMediaBlobs", value: report.managedMediaSync.localMediaBlobs },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.localMediaBytes", value: report.managedMediaSync.localMediaBytes },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.referencedMediaInCards", value: report.managedMediaSync.referencedMediaInCards },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.referencesMissingLocalAsset", value: report.managedMediaSync.referencesMissingLocalAsset },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.assetsMissingLocalBlob", value: report.managedMediaSync.assetsMissingLocalBlob },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.pendingMediaUploads", value: report.managedMediaSync.pendingMediaUploads },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.failedMediaUploads", value: report.managedMediaSync.failedMediaUploads },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.pendingMediaDownloads", value: report.managedMediaSync.pendingMediaDownloads },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.failedMediaDownloads", value: report.managedMediaSync.failedMediaDownloads },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.oldestPendingMediaTransfer", value: report.managedMediaSync.oldestPendingMediaTransfer },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.latestMediaUploadSuccess", value: report.managedMediaSync.latestMediaUploadSuccess },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.latestMediaDownloadCacheSuccess", value: report.managedMediaSync.latestMediaDownloadCacheSuccess },
    { labelKey: "settingsTest.localSyncDiagnostics.fields.latestMediaTransferError", value: report.managedMediaSync.latestMediaTransferError },
  ];
}

export function TestLocalSyncDiagnosticsScreen(): ReactElement {
  const { activeWorkspace } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatNumber } = useI18n();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const isMountedRef = useRef<boolean>(false);
  const [report, setReport] = useState<LocalSyncDiagnosticsReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string>("");
  const [copyStatusMessage, setCopyStatusMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");

  const refreshDiagnostics = useCallback(async (): Promise<void> => {
    if (activeWorkspaceId === null) {
      setReport(null);
      setLoadErrorMessage(t("settingsTest.localSyncDiagnostics.noWorkspace"));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadErrorMessage("");
    setCopyStatusMessage("");

    try {
      const nextReport = await loadLocalSyncDiagnosticsReport(activeWorkspaceId);
      if (isMountedRef.current === false) {
        return;
      }

      setReport(nextReport);
    } catch (error) {
      if (isMountedRef.current === false) {
        return;
      }

      showCapturedTechnicalError(error);
      setReport(null);
      setLoadErrorMessage(technicalErrorMessage);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeWorkspaceId, showCapturedTechnicalError, t, technicalErrorMessage]);

  useEffect(() => {
    isMountedRef.current = true;

    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  async function copyDiagnostics(): Promise<void> {
    if (report === null) {
      return;
    }

    setCopyStatusMessage("");

    if (typeof navigator.clipboard?.writeText !== "function") {
      setCopyStatusMessage(t("settingsTest.localSyncDiagnostics.clipboardUnavailable"));
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyStatusMessage(t("settingsTest.localSyncDiagnostics.copied"));
    } catch {
      setCopyStatusMessage(t("settingsTest.localSyncDiagnostics.copyFailed"));
    }
  }

  return (
    <SettingsShell
      title={t("settingsTest.localSyncDiagnostics.screenTitle")}
      subtitle={t("settingsTest.localSyncDiagnostics.screenSubtitle")}
      activeTab="test"
      panelClassName="settings-panel-test-local-sync-diagnostics"
    >
      <div className="settings-diagnostics-screen" data-testid="test-local-sync-diagnostics-screen">
        <div className="settings-diagnostics-toolbar">
          <p className="subtitle">
            {t("settingsTest.localSyncDiagnostics.generatedAt", {
              value: report?.generatedAt ?? t("settingsTest.localSyncDiagnostics.unavailable"),
            })}
          </p>
          <div className="screen-actions settings-diagnostics-actions">
            <button
              className="ghost-btn"
              type="button"
              disabled={isLoading}
              onClick={() => void refreshDiagnostics()}
              data-testid="local-sync-diagnostics-refresh-button"
            >
              {isLoading ? t("settingsTest.localSyncDiagnostics.refreshing") : t("settingsTest.localSyncDiagnostics.refresh")}
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={report === null}
              onClick={() => void copyDiagnostics()}
              data-testid="local-sync-diagnostics-copy-button"
            >
              {t("settingsTest.localSyncDiagnostics.copy")}
            </button>
          </div>
        </div>

        {loadErrorMessage === "" ? null : <p className="error-banner">{loadErrorMessage}</p>}
        {copyStatusMessage === "" ? null : (
          <p className="settings-diagnostics-copy-status" aria-live="polite" data-testid="local-sync-diagnostics-copy-status">
            {copyStatusMessage}
          </p>
        )}

        {report === null ? (
          <section className="panel panel-center state-panel settings-diagnostics-state">
            <p className="subtitle">
              {isLoading ? t("settingsTest.localSyncDiagnostics.loading") : t("settingsTest.localSyncDiagnostics.unavailable")}
            </p>
          </section>
        ) : (
          <>
            <SettingsGroup title={t("settingsTest.localSyncDiagnostics.sections.cardsSync")}>
              <DiagnosticFieldGrid fields={buildCardsSyncFields(report)} formatNumber={formatNumber} t={t} />
            </SettingsGroup>

            <SettingsGroup title={t("settingsTest.localSyncDiagnostics.sections.managedMediaSync")}>
              <DiagnosticFieldGrid fields={buildManagedMediaSyncFields(report)} formatNumber={formatNumber} t={t} />
            </SettingsGroup>

            <SettingsGroup title={t("settingsTest.localSyncDiagnostics.sections.problemRecords")}>
              <div className="settings-diagnostics-problem-list">
                <ProblemRecordSection
                  title={t("settingsTest.localSyncDiagnostics.problem.failedCardOutboxOperations")}
                  isEmpty={report.problemRecords.failedCardOutboxOperations.length === 0}
                  emptyMessage={t("settingsTest.localSyncDiagnostics.problem.empty")}
                >
                  {report.problemRecords.failedCardOutboxOperations.map((record) => (
                    <div className="settings-diagnostics-problem-record content-card" key={record.operationId}>
                      <code>{record.operationId}</code>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.cardId")}: <code>{record.cardId}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.attemptCount")}: {formatNumber(record.attemptCount)}</span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.createdAt")}: <code>{record.createdAt}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.error")}: <code>{record.lastError}</code></span>
                    </div>
                  ))}
                </ProblemRecordSection>

                <ProblemRecordSection
                  title={t("settingsTest.localSyncDiagnostics.problem.failedMediaTransfers")}
                  isEmpty={report.problemRecords.failedMediaTransfers.length === 0}
                  emptyMessage={t("settingsTest.localSyncDiagnostics.problem.empty")}
                >
                  {report.problemRecords.failedMediaTransfers.map((record) => (
                    <div className="settings-diagnostics-problem-record content-card" key={record.transferId}>
                      <code>{record.transferId}</code>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.mediaAssetId")}: <code>{record.mediaAssetId}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.kind")}: <code>{record.kind}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.attemptCount")}: {formatNumber(record.attemptCount)}</span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.updatedAt")}: <code>{record.updatedAt}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.error")}: <code>{record.lastError}</code></span>
                    </div>
                  ))}
                </ProblemRecordSection>

                <ProblemRecordSection
                  title={t("settingsTest.localSyncDiagnostics.problem.missingMediaReferences")}
                  isEmpty={report.problemRecords.missingMediaReferences.length === 0}
                  emptyMessage={t("settingsTest.localSyncDiagnostics.problem.empty")}
                >
                  {report.problemRecords.missingMediaReferences.map((record) => (
                    <div className="settings-diagnostics-problem-record content-card" key={record.mediaAssetId}>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.mediaAssetId")}: <code>{record.mediaAssetId}</code></span>
                    </div>
                  ))}
                </ProblemRecordSection>

                <ProblemRecordSection
                  title={t("settingsTest.localSyncDiagnostics.problem.assetsMissingLocalBlob")}
                  isEmpty={report.problemRecords.assetsMissingLocalBlob.length === 0}
                  emptyMessage={t("settingsTest.localSyncDiagnostics.problem.empty")}
                >
                  {report.problemRecords.assetsMissingLocalBlob.map((record) => (
                    <div className="settings-diagnostics-problem-record content-card" key={record.mediaAssetId}>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.mediaAssetId")}: <code>{record.mediaAssetId}</code></span>
                      <span>{t("settingsTest.localSyncDiagnostics.problem.sha256")}: <code>{record.sha256}</code></span>
                    </div>
                  ))}
                </ProblemRecordSection>
              </div>
            </SettingsGroup>
          </>
        )}
      </div>
    </SettingsShell>
  );
}

function reviewRatingTitle(rating: ReviewReactionRating, t: Translate): string {
  switch (rating) {
    case "again":
      return t("reviewScreen.ratings.again");
    case "hard":
      return t("reviewScreen.ratings.hard");
    case "good":
      return t("reviewScreen.ratings.good");
    case "easy":
      return t("reviewScreen.ratings.easy");
  }
}

function testAnimationProbabilityText(
  entry: ReviewReactionVariantDistributionEntry,
  formatNumber: FormatNumber,
  t: Translate,
): string {
  const percentText = `${formatNumber(reviewReactionVariantProbabilityPercent(entry), probabilityFormatOptions)}%`;
  return t("settingsTest.animations.probability", {
    percent: percentText,
  });
}

function testAnimationAccessibilityLabel(
  entry: ReviewReactionVariantDistributionEntry,
  formatNumber: FormatNumber,
  t: Translate,
): string {
  return t("settingsTest.animations.playAccessibility", {
    variant: entry.variant,
    probability: testAnimationProbabilityText(entry, formatNumber, t),
  });
}

function clearReviewReactionTimer(
  cleanupTimers: Map<string, number>,
  eventId: string,
): void {
  const timerId = cleanupTimers.get(eventId);
  if (timerId === undefined) {
    return;
  }

  window.clearTimeout(timerId);
  cleanupTimers.delete(eventId);
}

function clearTrimmedReviewReactionTimers(
  cleanupTimers: Map<string, number>,
  retainedEvents: ReadonlyArray<ReviewReactionEvent>,
): void {
  const retainedEventIds = new Set(retainedEvents.map((event) => event.id));
  for (const eventId of cleanupTimers.keys()) {
    if (!retainedEventIds.has(eventId)) {
      clearReviewReactionTimer(cleanupTimers, eventId);
      releaseReviewReactionLottieRender(eventId);
    }
  }
}

export function TestAnimationsScreen(): ReactElement {
  const { t, formatNumber } = useI18n();
  const [activeReviewReactionEvents, setActiveReviewReactionEvents] = useState<ReadonlyArray<ReviewReactionEvent>>([]);
  const [motionMode, setMotionMode] = useState<ReviewReactionMotionMode>(
    matchesReducedReviewReactionMotion() ? "reduced" : "standard",
  );
  const activeReviewReactionEventsRef = useRef<ReadonlyArray<ReviewReactionEvent>>([]);
  const cleanupTimersRef = useRef<Map<string, number>>(new Map<string, number>());
  const isMountedRef = useRef<boolean>(false);

  function reportTestAnimationPlaybackFailure(
    error: unknown,
    entry: ReviewReactionVariantDistributionEntry,
  ): void {
    console.warn("Review reaction test animation failed.", {
      error,
      rating: entry.rating,
      variant: entry.variant,
    });
  }

  useEffect(() => {
    startReviewReactionLottiePrewarm();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(reducedReviewReactionMotionMediaQuery);
    const handleMediaQueryChange = (event: MediaQueryListEvent): void => {
      setMotionMode(event.matches ? "reduced" : "standard");
    };

    setMotionMode(mediaQueryList.matches ? "reduced" : "standard");
    mediaQueryList.addEventListener("change", handleMediaQueryChange);
    return (): void => {
      mediaQueryList.removeEventListener("change", handleMediaQueryChange);
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return (): void => {
      isMountedRef.current = false;
      for (const timerId of cleanupTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      cleanupTimersRef.current.clear();
      for (const event of activeReviewReactionEventsRef.current) {
        releaseReviewReactionLottieRender(event.id);
      }
      activeReviewReactionEventsRef.current = [];
    };
  }, []);

  useLayoutEffect(() => {
    clearTrimmedReviewReactionTimers(cleanupTimersRef.current, activeReviewReactionEvents);
  }, [activeReviewReactionEvents]);

  const removeReviewReactionEvent = useCallback((eventId: string): void => {
    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    setActiveReviewReactionEvents((currentEvents) => {
      const nextEvents = currentEvents.filter((activeEvent) => activeEvent.id !== eventId);
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }, []);

  const scheduleReviewReactionEventCleanup = useCallback((
    eventId: string,
    variant: ReviewReactionRenderableVariant,
  ): void => {
    const cleanupTimerId = window.setTimeout(() => {
      removeReviewReactionEvent(eventId);
    }, reviewReactionCleanupDelayMillis(variant, motionMode));
    cleanupTimersRef.current.set(eventId, cleanupTimerId);
  }, [motionMode, removeReviewReactionEvent]);

  const handleReviewReactionEventFallback = useCallback((eventId: string): void => {
    const event = activeReviewReactionEventsRef.current.find((activeEvent) => activeEvent.id === eventId);
    if (event === undefined || !isReviewReactionLottieVariant(event.variant)) {
      return;
    }

    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    const fallbackEventId = crypto.randomUUID();
    scheduleReviewReactionEventCleanup(fallbackEventId, reviewReactionLottieFallbackVariant);
    setActiveReviewReactionEvents((currentEvents) => {
      const nextEvents = currentEvents.map((activeEvent) => {
        if (activeEvent.id !== eventId || !isReviewReactionLottieVariant(activeEvent.variant)) {
          return activeEvent;
        }

        return {
          ...activeEvent,
          id: fallbackEventId,
          variant: reviewReactionLottieFallbackVariant,
        };
      });
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }, [scheduleReviewReactionEventCleanup]);

  async function reserveTestAnimationRender(
    eventId: string,
    variant: ReviewReactionVariantDistributionEntry["variant"],
  ): Promise<void> {
    if (!isReviewReactionLottieVariant(variant)) {
      throw new Error(`Test animation variant ${variant} is not a Lottie variant.`);
    }
    if (reserveReviewReactionLottieRender(eventId, variant)) {
      return;
    }

    await loadReviewReactionLottieAsset(variant);
    if (reserveReviewReactionLottieRender(eventId, variant)) {
      return;
    }

    throw new Error(`Test animation variant ${variant} was not available after prewarm.`);
  }

  async function playAnimation(entry: ReviewReactionVariantDistributionEntry): Promise<void> {
    if (!isReviewReactionLottieVariant(entry.variant)) {
      throw new Error(`Test animation entry ${entry.id} is not a Lottie variant.`);
    }

    const eventId = crypto.randomUUID();
    await reserveTestAnimationRender(eventId, entry.variant);
    if (!isMountedRef.current) {
      releaseReviewReactionLottieRender(eventId);
      return;
    }

    const event: ReviewReactionEvent = {
      id: eventId,
      rating: entry.rating,
      variant: entry.variant,
    };
    scheduleReviewReactionEventCleanup(event.id, event.variant);

    setActiveReviewReactionEvents((currentEvents) => {
      const nextEvents = appendReviewReactionEvent(
        currentEvents,
        event,
        reviewReactionMaximumActiveEvents,
      );
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }

  return (
    <SettingsShell
      title={t("settingsTest.animations.screenTitle")}
      subtitle={t("settingsTest.animations.screenSubtitle")}
      activeTab="test"
      panelClassName="settings-panel-test-animations"
    >
      <div className="settings-test-animation-list" data-testid="test-animations-screen">
        {reviewReactionRatings.map((rating) => (
          <SettingsGroup key={rating} title={reviewRatingTitle(rating, t)}>
            <div className="settings-test-animation-rows">
              {reviewReactionVariantDistributionEntries(rating).map((entry) => (
                <button
                  key={entry.id}
                  className="settings-test-animation-row content-card"
                  type="button"
                  aria-label={testAnimationAccessibilityLabel(entry, formatNumber, t)}
                  data-review-reaction-rating={entry.rating}
                  data-review-reaction-variant={entry.variant}
                  data-testid="test-animation-row"
                  onClick={() => {
                    void playAnimation(entry).catch((error: unknown) => {
                      reportTestAnimationPlaybackFailure(error, entry);
                    });
                  }}
                >
                  <span className="settings-test-animation-name">{entry.variant}</span>
                  <span className="badge">
                    {testAnimationProbabilityText(entry, formatNumber, t)}
                  </span>
                </button>
              ))}
            </div>
          </SettingsGroup>
        ))}
      </div>
      <ReviewRatingReactionLayer
        events={activeReviewReactionEvents}
        onReactionEventFallback={handleReviewReactionEventFallback}
      />
    </SettingsShell>
  );
}
