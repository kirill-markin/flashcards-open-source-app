import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes as RouterRoutes, useLocation, useParams } from "react-router-dom";
import { AccountMenu } from "./AccountMenu";
import {
  clearAllLocalBrowserData,
  deleteAccountConfirmationText,
  isAccountDeletionPending,
  loadAccountDeletionCsrfToken,
  subscribeToAccountDeletionPending,
} from "./accountDeletion";
import { AppDataProvider, useAppData } from "./appData";
import { AppErrorDialogProvider } from "./appError/AppErrorContext";
import {
  ApiError,
  ApiContractError,
  buildLoginUrl,
  buildLogoutLocalUrl,
  buildLogoutUrl,
  deleteMyAccount,
  primeSessionCsrfToken,
} from "./api";
import { ChatDraftProvider } from "./chat/composer/ChatDraftContext";
import { ChatLayoutProvider, useChatLayout } from "./chat/layout/ChatLayoutContext";
import { ChatSessionControllerProvider } from "./chat/sessionController";
import { ChatToggle } from "./chat/layout/ChatToggle";
import { useAppErrorDialog } from "./appError/AppErrorContext";
import { type TranslationKey, useI18n } from "./i18n";
import { captureApiContractError } from "./observability/apiContractObservation";
import { captureAppOperationError } from "./observability/appOperationObservation";
import { AppErrorBoundary, wrapRoutesComponent } from "./observability/instrument";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
  accountSupportRoute,
  buildSettingsDeckDetailRoute,
  buildSettingsDeckEditRoute,
  cardsRoute,
  chatRoute,
  friendInviteRoutePattern,
  friendInvitePreviewIndexRoute,
  friendInvitePreviewRoutePattern,
  progressRoute,
  reviewRoute,
  settingsAccessRoute,
  settingsAccessDetailRoutePattern,
  settingsCurrentWorkspaceRoute,
  settingsDeckNewRoute,
  settingsDecksRoute,
  settingsDeleteCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsExportRoute,
  settingsFeedbackRoute,
  settingsHubRoute,
  settingsLanguageRoute,
  settingsLeaderboardParticipationRoute,
  settingsNotificationsRoute,
  settingsReviewAnimationsRoute,
  settingsResetStudyProgressRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
  settingsTagsRoute,
  settingsTestAnimationsRoute,
  settingsTestRoute,
} from "./routes";
import { isWorkspaceManagementLocked } from "./workspaceManagement";
import { TestModeProvider, useTestMode } from "./testMode";
import { CardFormScreen } from "./screens/cards/form/CardFormScreen";
import { CardsScreen } from "./screens/cards/list/CardsScreen";
import { FriendInviteScreen } from "./screens/invite/FriendInviteScreen";
import { ProgressScreen } from "./screens/progress/ProgressScreen";
import { ReviewScreen } from "./screens/review/ReviewScreen";

const SentryRoutes = wrapRoutesComponent(RouterRoutes);

type PrimaryNavigationItem = {
  readonly route: string;
  readonly labelKey: TranslationKey;
};

const primaryNavigationItems: ReadonlyArray<PrimaryNavigationItem> = [
  { route: reviewRoute, labelKey: "navigation.review" },
  { route: progressRoute, labelKey: "navigation.progress" },
  { route: chatRoute, labelKey: "navigation.aiChat" },
  { route: cardsRoute, labelKey: "navigation.cards" },
  { route: settingsHubRoute, labelKey: "navigation.settings" },
];

const ChatPanel = lazy(async () => import("./chat/ChatPanel").then((module) => ({ default: module.ChatPanel })));
const FriendInvitePreviewScreen = lazy(async () => import("./dev/previews/invite/FriendInvitePreviewScreen").then((module) => ({
  default: module.FriendInvitePreviewScreen,
})));
const AccessPermissionDetailScreen = lazy(async () => import("./screens/settings/access/AccessPermissionDetailScreen").then((module) => ({
  default: module.AccessPermissionDetailScreen,
})));
const AccessSettingsScreen = lazy(async () => import("./screens/settings/access/AccessSettingsScreen").then((module) => ({
  default: module.AccessSettingsScreen,
})));
const AccountStatusScreen = lazy(async () => import("./screens/settings/account/AccountStatusScreen").then((module) => ({
  default: module.AccountStatusScreen,
})));
const AgentConnectionsScreen = lazy(async () => import("./screens/settings/account/AgentConnectionsScreen").then((module) => ({
  default: module.AgentConnectionsScreen,
})));
const DeckDetailScreen = lazy(async () => import("./screens/settings/workspace/decks/DeckDetailScreen").then((module) => ({
  default: module.DeckDetailScreen,
})));
const DeckFormScreen = lazy(async () => import("./screens/settings/workspace/decks/DeckFormScreen").then((module) => ({
  default: module.DeckFormScreen,
})));
const DecksScreen = lazy(async () => import("./screens/settings/workspace/decks/DecksScreen").then((module) => ({
  default: module.DecksScreen,
})));
const DangerZoneScreen = lazy(async () => import("./screens/settings/account/DangerZoneScreen").then((module) => ({
  default: module.DangerZoneScreen,
})));
const CurrentWorkspaceScreen = lazy(async () => import("./screens/settings/workspace/CurrentWorkspaceScreen").then((module) => ({
  default: module.CurrentWorkspaceScreen,
})));
const DeleteCurrentWorkspaceScreen = lazy(async () => import("./screens/settings/workspace/DeleteCurrentWorkspaceScreen").then((module) => ({
  default: module.DeleteCurrentWorkspaceScreen,
})));
const FeedbackSettingsScreen = lazy(async () => import("./screens/settings/FeedbackSettingsScreen").then((module) => ({
  default: module.FeedbackSettingsScreen,
})));
const LanguageSettingsScreen = lazy(async () => import("./screens/settings/LanguageSettingsScreen").then((module) => ({
  default: module.LanguageSettingsScreen,
})));
const LeaderboardParticipationSettingsScreen = lazy(async () => import("./screens/settings/LeaderboardParticipationSettingsScreen").then((module) => ({
  default: module.LeaderboardParticipationSettingsScreen,
})));
const SettingsScreen = lazy(async () => import("./screens/settings/SettingsScreen").then((module) => ({
  default: module.SettingsScreen,
})));
const LegalScreen = lazy(async () => import("./screens/settings/account/LegalScreen").then((module) => ({
  default: module.LegalScreen,
})));
const SupportScreen = lazy(async () => import("./screens/settings/account/SupportScreen").then((module) => ({
  default: module.SupportScreen,
})));
const OpenSourceSettingsScreen = lazy(async () => import("./screens/settings/account/OpenSourceSettingsScreen").then((module) => ({
  default: module.OpenSourceSettingsScreen,
})));
const NotificationsSettingsScreen = lazy(async () => import("./screens/settings/NotificationsSettingsScreen").then((module) => ({
  default: module.NotificationsSettingsScreen,
})));
const ReviewAnimationsSettingsScreen = lazy(async () => import("./screens/settings/ReviewAnimationsSettingsScreen").then((module) => ({
  default: module.ReviewAnimationsSettingsScreen,
})));
const ThisDeviceSettingsScreen = lazy(async () => import("./screens/settings/ThisDeviceSettingsScreen").then((module) => ({
  default: module.ThisDeviceSettingsScreen,
})));
const ResetStudyProgressScreen = lazy(async () => import("./screens/settings/workspace/ResetStudyProgressScreen").then((module) => ({
  default: module.ResetStudyProgressScreen,
})));
const ServerSettingsInfoScreen = lazy(async () => import("./screens/settings/ServerSettingsInfoScreen").then((module) => ({
  default: module.ServerSettingsInfoScreen,
})));
const TestAnimationsScreen = lazy(async () => import("./screens/settings/TestSettingsScreen").then((module) => ({
  default: module.TestAnimationsScreen,
})));
const TestSettingsScreen = lazy(async () => import("./screens/settings/TestSettingsScreen").then((module) => ({
  default: module.TestSettingsScreen,
})));
const TagsScreen = lazy(async () => import("./screens/settings/workspace/TagsScreen").then((module) => ({
  default: module.TagsScreen,
})));
const WorkspaceSchedulerScreen = lazy(async () => import("./screens/settings/workspace/WorkspaceSchedulerScreen").then((module) => ({
  default: module.WorkspaceSchedulerScreen,
})));
const WorkspaceExportScreen = lazy(async () => import("./screens/settings/workspace/WorkspaceExportScreen").then((module) => ({
  default: module.WorkspaceExportScreen,
})));

function RouteContentFallback(props: Readonly<{ messageKey: TranslationKey }>): ReactElement {
  const { messageKey } = props;
  const { t } = useI18n();

  return (
    <main className="container">
      <section className="panel">
        <p className="subtitle">{t(messageKey)}</p>
      </section>
    </main>
  );
}

function SidebarChatFallback(): ReactElement {
  const { chatWidth } = useChatLayout();
  const { t } = useI18n();

  return (
    <section className="chat-sidebar chat-sidebar-loading" style={{ width: chatWidth }}>
      <div className="chat-loading-shell">
        <div className="chat-header">
          <span className="chat-header-title">{t("navigation.aiChat")}</span>
        </div>
        <div className="chat-messages">
          <div className="chat-empty chat-empty-loading">
            <p className="chat-empty-title">{t("loading.aiChat")}</p>
            <div className="chat-loading-lines" aria-hidden="true">
              <span className="chat-loading-line chat-loading-line-title" />
              <span className="chat-loading-line" />
              <span className="chat-loading-line" />
              <span className="chat-loading-line chat-loading-line-short" />
            </div>
          </div>
        </div>
        <div className="chat-input-area chat-input-area-loading" aria-hidden="true">
          <div className="chat-loading-composer" />
          <div className="chat-loading-controls">
            <span className="chat-loading-chip" />
            <span className="chat-loading-chip chat-loading-chip-round" />
            <span className="chat-loading-chip chat-loading-chip-round" />
            <span className="chat-loading-chip chat-loading-chip-accent" />
          </div>
        </div>
      </div>
    </section>
  );
}

function FullscreenChatFallback(): ReactElement {
  const { t } = useI18n();

  return (
    <section className="chat-sidebar-fullscreen chat-sidebar-fullscreen-loading">
      <div className="chat-loading-shell">
        <div className="chat-header">
          <span className="chat-header-title">{t("navigation.aiChat")}</span>
        </div>
        <div className="chat-messages">
          <div className="chat-empty chat-empty-loading">
            <p className="chat-empty-title">{t("loading.aiChat")}</p>
            <div className="chat-loading-lines" aria-hidden="true">
              <span className="chat-loading-line chat-loading-line-title" />
              <span className="chat-loading-line" />
              <span className="chat-loading-line" />
              <span className="chat-loading-line chat-loading-line-short" />
            </div>
          </div>
        </div>
        <div className="chat-input-area chat-input-area-loading" aria-hidden="true">
          <div className="chat-loading-composer" />
          <div className="chat-loading-controls">
            <span className="chat-loading-chip" />
            <span className="chat-loading-chip chat-loading-chip-round" />
            <span className="chat-loading-chip chat-loading-chip-round" />
            <span className="chat-loading-chip chat-loading-chip-accent" />
          </div>
        </div>
      </div>
    </section>
  );
}

function AppCrashFallback(): ReactElement {
  const { t } = useI18n();

  function reloadPage(): void {
    window.location.reload();
  }

  return (
    <main className="page-state">
      <section className="panel panel-center state-panel" role="alert" aria-live="assertive">
        <h1 className="title">{t("app.crashTitle")}</h1>
        <p className="subtitle">{t("app.crashMessage")}</p>
        <button className="primary-btn" type="button" onClick={reloadPage}>
          {t("app.crashReload")}
        </button>
      </section>
    </main>
  );
}

function renderDeferredRoute(
  element: ReactElement,
  messageKey: TranslationKey,
): ReactElement {
  return (
    <Suspense fallback={<RouteContentFallback messageKey={messageKey} />}>
      {element}
    </Suspense>
  );
}

function LegacyDeckDetailRedirect(): ReactElement {
  const { deckId } = useParams();

  if (deckId === undefined || deckId === "") {
    throw new Error("Legacy deck redirect is missing deckId");
  }

  return <Navigate replace to={buildSettingsDeckDetailRoute(deckId)} />;
}

function LegacyDeckEditRedirect(): ReactElement {
  const { deckId } = useParams();

  if (deckId === undefined || deckId === "") {
    throw new Error("Legacy deck edit redirect is missing deckId");
  }

  return <Navigate replace to={buildSettingsDeckEditRoute(deckId)} />;
}

function TestModeRouteGuard(props: Readonly<{ children: ReactElement }>): ReactElement {
  const { children } = props;
  const { isTestModeEnabled } = useTestMode();

  if (isTestModeEnabled === false) {
    return <Navigate replace to={settingsHubRoute} />;
  }

  return children;
}

export function AppShell(): ReactElement {
  const location = useLocation();
  const { locale, t, formatDateTime } = useI18n();
  const {
    sessionLoadState,
    sessionVerificationState,
    isSessionVerified,
    sessionErrorMessage,
    sessionTechnicalError,
    session,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    isSyncing,
    errorMessage,
    technicalError,
    initialize,
    chooseWorkspace,
    createWorkspace,
    cloudSettings,
  } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const [isAccountDeletionPendingState, setIsAccountDeletionPendingState] = useState<boolean>(isAccountDeletionPending);
  const [accountDeletionErrorMessage, setAccountDeletionErrorMessage] = useState<string>("");
  const [accountDeletionTechnicalError, setAccountDeletionTechnicalError] = useState<Error | null>(null);
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState<boolean>(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState<boolean>(false);
  const shownSessionTechnicalErrorRef = useRef<Error | null>(null);
  const shownGlobalTechnicalErrorRef = useRef<Error | null>(null);
  const sessionRestoringMessage = sessionVerificationState === "unverified" ? t("loading.restoringSession") : "";
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;
  const activeWorkspaceName: string | null = activeWorkspace?.name ?? null;
  const visibleTechnicalErrorMessage = t("appError.technicalError.message");
  const visibleSessionErrorMessage = sessionErrorMessage === ""
    ? ""
    : sessionTechnicalError === null
      ? sessionErrorMessage
      : visibleTechnicalErrorMessage;
  const visibleGlobalErrorMessage = errorMessage === ""
    ? ""
    : technicalError === null
      ? errorMessage
      : visibleTechnicalErrorMessage;
  const visibleAccountDeletionErrorMessage = accountDeletionErrorMessage === ""
    ? ""
    : accountDeletionTechnicalError === null
      ? accountDeletionErrorMessage
      : visibleTechnicalErrorMessage;

  const completeAccountDeletion = useCallback(async function completeAccountDeletion(): Promise<void> {
    if (isSessionVerified === false) {
      return;
    }

    setIsAccountDeletionSubmitting(true);
    setAccountDeletionErrorMessage("");
    setAccountDeletionTechnicalError(null);

    try {
      const persistedCsrfToken = loadAccountDeletionCsrfToken();
      if (persistedCsrfToken !== null) {
        primeSessionCsrfToken(persistedCsrfToken);
      }
      await deleteMyAccount(deleteAccountConfirmationText);
      await clearAllLocalBrowserData("account_deletion_submit");
      window.location.href = buildLogoutLocalUrl();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACCOUNT_DELETED") {
        await clearAllLocalBrowserData("account_deletion_submit");
        window.location.href = buildLogoutLocalUrl();
        return;
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error));
      let wasCaptured = false;
      if (normalizedError instanceof ApiContractError) {
        captureApiContractError(normalizedError, {
          feature: "auth",
          sourceAction: "account_deletion_submit",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
        });
        wasCaptured = true;
      } else {
        wasCaptured = captureAppOperationError(normalizedError, {
          feature: "auth",
          operation: "account_deletion_submit",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: null,
        });
      }

      setAccountDeletionErrorMessage(normalizedError.message);
      setAccountDeletionTechnicalError(wasCaptured ? normalizedError : null);
      if (wasCaptured) {
        showCapturedTechnicalError(normalizedError);
      }
    } finally {
      setIsAccountDeletionSubmitting(false);
    }
  }, [activeWorkspace?.workspaceId, cloudSettings?.installationId, isSessionVerified, session?.userId, showCapturedTechnicalError]);

  useEffect(() => subscribeToAccountDeletionPending(() => {
    setIsAccountDeletionPendingState(isAccountDeletionPending());
  }), []);

  useEffect(() => {
    setIsMobileNavigationOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isMobileNavigationOpen === false) {
      return undefined;
    }

    function closeMobileNavigationOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsMobileNavigationOpen(false);
      }
    }

    window.addEventListener("keydown", closeMobileNavigationOnEscape);

    return () => {
      window.removeEventListener("keydown", closeMobileNavigationOnEscape);
    };
  }, [isMobileNavigationOpen]);

  useEffect(() => {
    if (
      isSessionVerified
      && isAccountDeletionPendingState
      && !isAccountDeletionSubmitting
      && accountDeletionErrorMessage === ""
    ) {
      void completeAccountDeletion();
    }
  }, [accountDeletionErrorMessage, completeAccountDeletion, isAccountDeletionPendingState, isAccountDeletionSubmitting, isSessionVerified]);

  useEffect(() => {
    if (sessionLoadState !== "error" || sessionTechnicalError === null) {
      shownSessionTechnicalErrorRef.current = null;
      return;
    }

    if (shownSessionTechnicalErrorRef.current === sessionTechnicalError) {
      return;
    }

    shownSessionTechnicalErrorRef.current = sessionTechnicalError;
    showCapturedTechnicalError(sessionTechnicalError);
  }, [sessionLoadState, sessionTechnicalError, showCapturedTechnicalError]);

  useEffect(() => {
    if (errorMessage === "" || technicalError === null) {
      shownGlobalTechnicalErrorRef.current = null;
      return;
    }

    if (shownGlobalTechnicalErrorRef.current === technicalError) {
      return;
    }

    shownGlobalTechnicalErrorRef.current = technicalError;
    showCapturedTechnicalError(technicalError);
  }, [errorMessage, showCapturedTechnicalError, technicalError]);

  function toggleMobileNavigation(): void {
    setIsMobileNavigationOpen((currentValue: boolean): boolean => !currentValue);
  }

  if (isAccountDeletionPendingState) {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.deleteAccountTitle")}</h1>
          <p className="subtitle">
            {isSessionVerified
              ? t("app.deleteAccountInProgress")
              : t("app.deleteAccountRestoring")}
          </p>
          {visibleAccountDeletionErrorMessage !== "" ? <p className="error-banner">{visibleAccountDeletionErrorMessage}</p> : null}
          <button
            className="primary-btn"
            type="button"
            disabled={isAccountDeletionSubmitting}
            onClick={() => void completeAccountDeletion()}
          >
            {isAccountDeletionSubmitting ? t("app.deleting") : t("app.deleteAccountRetry")}
          </button>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <p className="subtitle">{sessionLoadState === "redirecting" ? t("loading.redirectingToLogin") : t("loading.generic")}</p>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "error") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.title")}</h1>
          <p className="error-banner">{visibleSessionErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void initialize()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "deleted") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.title")}</h1>
          <p className="subtitle">{sessionErrorMessage}</p>
          <a className="primary-btn" href={buildLoginUrl(window.location.origin, locale)}>
            {t("app.signInAgain")}
          </a>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "selecting_workspace") {
    return (
      <main className="page-state">
        <section className="panel panel-center workspace-modal state-panel">
          <h1 className="title">{t("app.chooseWorkspaceTitle")}</h1>
          <p className="subtitle">{t("app.chooseWorkspaceSubtitle")}</p>
          <div className="workspace-choice-list">
            {availableWorkspaces.map((workspace) => (
              <button
                key={workspace.workspaceId}
                className="ghost-btn workspace-choice-btn"
                type="button"
                onClick={() => void chooseWorkspace(workspace.workspaceId)}
                disabled={isChoosingWorkspace}
              >
                <span className="workspace-choice-name">{workspace.name}</span>
                <span className="workspace-choice-meta">{formatDateTime(workspace.createdAt)}</span>
              </button>
            ))}
          </div>
          {visibleGlobalErrorMessage !== "" ? <p className="error-banner">{visibleGlobalErrorMessage}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="header-sticky">
        <header className="topbar-shell">
          <div className="topbar">
            <div className="topbar-brand-block">
              <div className="topbar-brand-row">
                <a className="topbar-brand" href={reviewRoute}>
                  <span className="brand-full">Flashcards Open Source App</span>
                  <span className="brand-short">Flashcards</span>
                </a>
                {isSyncing ? <span className="topbar-sync-status">{t("app.syncing")}</span> : null}
                {!isSyncing && sessionRestoringMessage !== "" ? <span className="topbar-sync-status">{sessionRestoringMessage}</span> : null}
              </div>
              <span data-testid="topbar-active-workspace-id-value" hidden>{activeWorkspaceId ?? ""}</span>
              <span data-testid="topbar-active-workspace-value" hidden>{activeWorkspaceName ?? ""}</span>
              <span
                data-testid="topbar-active-workspace"
                data-workspace-id={activeWorkspaceId ?? ""}
                data-workspace-name={activeWorkspaceName ?? ""}
                hidden
              />
            </div>
            <nav className="nav" aria-label={t("shell.primaryNavigation")}>
              {primaryNavigationItems.map((item) => (
                <NavLink key={item.route} className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={item.route}>
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </nav>
            <div className="topbar-actions">
              <button
                className="mobile-nav-toggle"
                type="button"
                aria-label={t("shell.primaryNavigation")}
                aria-expanded={isMobileNavigationOpen}
                aria-controls="mobile-primary-navigation"
                onClick={toggleMobileNavigation}
              >
                <span className="mobile-nav-toggle-line" aria-hidden="true" />
                <span className="mobile-nav-toggle-line" aria-hidden="true" />
                <span className="mobile-nav-toggle-line" aria-hidden="true" />
              </button>
              <AccountMenu
                workspaces={availableWorkspaces}
                currentWorkspaceId={activeWorkspace?.workspaceId ?? ""}
                currentWorkspaceName={activeWorkspace?.name ?? t("common.unavailable")}
                isBusy={isChoosingWorkspace}
                isWorkspaceManagementLocked={isWorkspaceLocked}
                workspaceManagementLockedMessage={workspaceManagementLockedMessage}
                accountSettingsUrl={settingsHubRoute}
                logoutUrl={buildLogoutUrl()}
                onSelectWorkspace={chooseWorkspace}
                onCreateWorkspace={createWorkspace}
              />
            </div>
          </div>
          {isMobileNavigationOpen ? (
            <nav id="mobile-primary-navigation" className="mobile-nav-menu" aria-label={t("shell.primaryNavigation")}>
              {primaryNavigationItems.map((item) => (
                <NavLink
                  key={item.route}
                  className={({ isActive }) => `mobile-nav-link${isActive ? " mobile-nav-link-active" : ""}`}
                  to={item.route}
                  onClick={() => setIsMobileNavigationOpen(false)}
                >
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </nav>
          ) : null}
        </header>
      </div>
      {visibleGlobalErrorMessage !== "" ? (
        <div className="global-error-wrap">
          <div className="global-error">{visibleGlobalErrorMessage}</div>
        </div>
      ) : null}
      <RoutedShell />
    </div>
  );
}

function buildChatLayoutShellClassName(isFullscreenChat: boolean, isOpen: boolean): string {
  const sidebarStateClassName = !isFullscreenChat && isOpen
    ? "chat-layout-shell-sidebar-open"
    : "chat-layout-shell-sidebar-closed";

  return isFullscreenChat
    ? `chat-layout-shell ${sidebarStateClassName} chat-layout-shell-fullscreen`
    : `chat-layout-shell ${sidebarStateClassName}`;
}

function buildChatMainContentClassName(isFullscreenChat: boolean, isOpen: boolean): string {
  const sidebarStateClassName = !isFullscreenChat && isOpen
    ? "chat-main-content-sidebar-open"
    : "chat-main-content-sidebar-closed";

  return isFullscreenChat
    ? `chat-main-content ${sidebarStateClassName} chat-main-content-fullscreen`
    : `chat-main-content ${sidebarStateClassName}`;
}

export function RoutedShell(): ReactElement {
  const location = useLocation();
  const { isOpen } = useChatLayout();
  const isFullscreenChat = location.pathname === "/chat";
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shellClassName = buildChatLayoutShellClassName(isFullscreenChat, isOpen);
  const contentClassName = buildChatMainContentClassName(isFullscreenChat, isOpen);

  useEffect(() => {
    if (contentRef.current !== null) {
      contentRef.current.scrollTop = 0;
      contentRef.current.scrollLeft = 0;
    }
  }, [location.pathname]);

  return (
    <div className={shellClassName}>
      {!isFullscreenChat && isOpen ? (
        <Suspense fallback={<SidebarChatFallback />}>
          <ChatPanel mode="sidebar" />
        </Suspense>
      ) : null}
      <div ref={contentRef} className={contentClassName}>
        <SentryRoutes>
          <Route path="/" element={<Navigate replace to={reviewRoute} />} />
          <Route path={cardsRoute} element={<CardsScreen />} />
          <Route path={`${cardsRoute}/new`} element={<CardFormScreen />} />
          <Route path={`${cardsRoute}/:cardId`} element={<CardFormScreen />} />
          <Route path="/decks" element={<Navigate replace to={settingsDecksRoute} />} />
          <Route path="/decks/new" element={<Navigate replace to={settingsDeckNewRoute} />} />
          <Route path="/decks/:deckId/edit" element={<LegacyDeckEditRedirect />} />
          <Route path="/decks/:deckId" element={<LegacyDeckDetailRedirect />} />
          <Route path="/tags" element={<Navigate replace to={settingsTagsRoute} />} />
          <Route path={reviewRoute} element={<ReviewScreen />} />
          <Route path={progressRoute} element={<ProgressScreen />} />
          <Route path={settingsHubRoute} element={renderDeferredRoute(<SettingsScreen />, "loading.settings")} />
          <Route
            path={settingsCurrentWorkspaceRoute}
            element={renderDeferredRoute(<CurrentWorkspaceScreen />, "loading.currentWorkspace")}
          />
          <Route path={settingsFeedbackRoute} element={renderDeferredRoute(<FeedbackSettingsScreen />, "loading.settings")} />
          <Route path={settingsLanguageRoute} element={renderDeferredRoute(<LanguageSettingsScreen />, "loading.deviceDetails")} />
          <Route path={settingsLeaderboardParticipationRoute} element={renderDeferredRoute(<LeaderboardParticipationSettingsScreen />, "loading.settings")} />
          <Route path={settingsServerRoute} element={renderDeferredRoute(<ServerSettingsInfoScreen />, "loading.settings")} />
          <Route path={settingsAccessRoute} element={renderDeferredRoute(<AccessSettingsScreen />, "loading.accessSettings")} />
          <Route path={settingsAccessDetailRoutePattern} element={renderDeferredRoute(<AccessPermissionDetailScreen />, "loading.accessDetails")} />
          <Route path={settingsNotificationsRoute} element={renderDeferredRoute(<NotificationsSettingsScreen />, "loading.notificationSettings")} />
          <Route path={settingsReviewAnimationsRoute} element={renderDeferredRoute(<ReviewAnimationsSettingsScreen />, "loading.settings")} />
          <Route path={settingsSchedulerRoute} element={renderDeferredRoute(<WorkspaceSchedulerScreen />, "loading.schedulerSettings")} />
          <Route path={settingsExportRoute} element={renderDeferredRoute(<WorkspaceExportScreen />, "loading.exportSettings")} />
          <Route path={settingsResetStudyProgressRoute} element={renderDeferredRoute(<ResetStudyProgressScreen />, "loading.settings")} />
          <Route path={settingsDeleteCurrentWorkspaceRoute} element={renderDeferredRoute(<DeleteCurrentWorkspaceScreen />, "loading.currentWorkspace")} />
          <Route path={settingsDecksRoute} element={renderDeferredRoute(<DecksScreen />, "loading.decks")} />
          <Route path={settingsDeckNewRoute} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${settingsDecksRoute}/:deckId/edit`} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${settingsDecksRoute}/:deckId`} element={renderDeferredRoute(<DeckDetailScreen />, "loading.deckDetails")} />
          <Route path={settingsTagsRoute} element={renderDeferredRoute(<TagsScreen />, "loading.tags")} />
          <Route path={settingsDeviceRoute} element={renderDeferredRoute(<ThisDeviceSettingsScreen />, "loading.deviceDetails")} />
          <Route
            path={settingsTestRoute}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestSettingsScreen />
              </TestModeRouteGuard>
            ), "loading.testSettings")}
          />
          <Route
            path={settingsTestAnimationsRoute}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestAnimationsScreen />
              </TestModeRouteGuard>
            ), "loading.testAnimations")}
          />
          <Route path={accountStatusRoute} element={renderDeferredRoute(<AccountStatusScreen />, "loading.accountStatus")} />
          <Route path={accountLegalRoute} element={renderDeferredRoute(<LegalScreen />, "loading.legal")} />
          <Route path={accountSupportRoute} element={renderDeferredRoute(<SupportScreen />, "loading.support")} />
          <Route path={accountOpenSourceRoute} element={renderDeferredRoute(<OpenSourceSettingsScreen />, "loading.openSourceSettings")} />
          <Route path={accountAgentConnectionsRoute} element={renderDeferredRoute(<AgentConnectionsScreen />, "loading.agentConnections")} />
          <Route path={accountDangerZoneRoute} element={renderDeferredRoute(<DangerZoneScreen />, "loading.dangerZone")} />
          <Route
            path={chatRoute}
            element={(
              <Suspense fallback={(
                <main className="container chat-page">
                  <FullscreenChatFallback />
                </main>
              )}
              >
                <main className="container chat-page">
                  <ChatPanel mode="fullscreen" />
                </main>
              </Suspense>
            )}
          />
        </SentryRoutes>
      </div>
      {!isFullscreenChat && !isOpen ? <ChatToggle /> : null}
    </div>
  );
}

function AuthenticatedApp(): ReactElement {
  return (
    <AppDataProvider>
      <ChatLayoutProvider>
        <ChatSessionControllerProvider>
          <ChatDraftProvider>
            <AppShell />
          </ChatDraftProvider>
        </ChatSessionControllerProvider>
      </ChatLayoutProvider>
    </AppDataProvider>
  );
}

export default function App(): ReactElement {
  return (
    <AppErrorBoundary fallback={<AppCrashFallback />}>
      <BrowserRouter>
        <AppErrorDialogProvider>
          <TestModeProvider>
            <SentryRoutes>
              <Route
                path={friendInvitePreviewIndexRoute}
                element={renderDeferredRoute(<FriendInvitePreviewScreen />, "friendInvite.loading")}
              />
              <Route
                path={friendInvitePreviewRoutePattern}
                element={renderDeferredRoute(<FriendInvitePreviewScreen />, "friendInvite.loading")}
              />
              <Route path={friendInviteRoutePattern} element={<FriendInviteScreen />} />
              <Route path="/*" element={<AuthenticatedApp />} />
            </SentryRoutes>
          </TestModeProvider>
        </AppErrorDialogProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
