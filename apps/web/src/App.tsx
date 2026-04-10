import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AccountMenu } from "./AccountMenu";
import {
  clearAllLocalBrowserData,
  deleteAccountConfirmationText,
  isAccountDeletionPending,
  loadAccountDeletionCsrfToken,
  subscribeToAccountDeletionPending,
} from "./accountDeletion";
import { AppDataProvider, useAppData } from "./appData";
import {
  ApiError,
  buildLoginUrl,
  buildLogoutLocalUrl,
  buildLogoutUrl,
  deleteMyAccount,
  getPreferredAuthUiLocale,
  primeSessionCsrfToken,
} from "./api";
import { ChatDraftProvider } from "./chat/ChatDraftContext";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatSessionControllerProvider } from "./chat/sessionController";
import { ChatToggle } from "./chat/ChatToggle";
import { type TranslationKey, useI18n } from "./i18n";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalSupportRoute,
  accountOpenSourceRoute,
  accountSettingsRoute,
  accountStatusRoute,
  buildSettingsDeckDetailRoute,
  buildSettingsDeckEditRoute,
  cardsRoute,
  chatRoute,
  reviewRoute,
  settingsAccessRoute,
  settingsAccessDetailRoutePattern,
  settingsCurrentWorkspaceRoute,
  settingsDeckNewRoute,
  settingsDecksRoute,
  settingsDeviceRoute,
  settingsExportRoute,
  settingsHubRoute,
  settingsNotificationsRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
  workspaceSettingsRoute,
} from "./routes";
import { isWorkspaceManagementLocked } from "./workspaceManagement";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { ReviewScreen } from "./screens/ReviewScreen";

const ChatPanel = lazy(async () => import("./chat/ChatPanel").then((module) => ({ default: module.ChatPanel })));
const AccessPermissionDetailScreen = lazy(async () => import("./screens/AccessPermissionDetailScreen").then((module) => ({
  default: module.AccessPermissionDetailScreen,
})));
const AccessSettingsScreen = lazy(async () => import("./screens/AccessSettingsScreen").then((module) => ({
  default: module.AccessSettingsScreen,
})));
const AccountStatusScreen = lazy(async () => import("./screens/AccountStatusScreen").then((module) => ({
  default: module.AccountStatusScreen,
})));
const AccountSettingsScreen = lazy(async () => import("./screens/AccountSettingsScreen").then((module) => ({
  default: module.AccountSettingsScreen,
})));
const AgentConnectionsScreen = lazy(async () => import("./screens/AgentConnectionsScreen").then((module) => ({
  default: module.AgentConnectionsScreen,
})));
const DeckDetailScreen = lazy(async () => import("./screens/DeckDetailScreen").then((module) => ({
  default: module.DeckDetailScreen,
})));
const DeckFormScreen = lazy(async () => import("./screens/DeckFormScreen").then((module) => ({
  default: module.DeckFormScreen,
})));
const DecksScreen = lazy(async () => import("./screens/DecksScreen").then((module) => ({
  default: module.DecksScreen,
})));
const DangerZoneScreen = lazy(async () => import("./screens/DangerZoneScreen").then((module) => ({
  default: module.DangerZoneScreen,
})));
const CurrentWorkspaceScreen = lazy(async () => import("./screens/CurrentWorkspaceScreen").then((module) => ({
  default: module.CurrentWorkspaceScreen,
})));
const SettingsScreen = lazy(async () => import("./screens/SettingsScreen").then((module) => ({
  default: module.SettingsScreen,
})));
const LegalSupportScreen = lazy(async () => import("./screens/LegalSupportScreen").then((module) => ({
  default: module.LegalSupportScreen,
})));
const OpenSourceSettingsScreen = lazy(async () => import("./screens/OpenSourceSettingsScreen").then((module) => ({
  default: module.OpenSourceSettingsScreen,
})));
const NotificationsSettingsScreen = lazy(async () => import("./screens/NotificationsSettingsScreen").then((module) => ({
  default: module.NotificationsSettingsScreen,
})));
const ThisDeviceSettingsScreen = lazy(async () => import("./screens/ThisDeviceSettingsScreen").then((module) => ({
  default: module.ThisDeviceSettingsScreen,
})));
const TagsScreen = lazy(async () => import("./screens/TagsScreen").then((module) => ({
  default: module.TagsScreen,
})));
const WorkspaceOverviewScreen = lazy(async () => import("./screens/WorkspaceOverviewScreen").then((module) => ({
  default: module.WorkspaceOverviewScreen,
})));
const WorkspaceSchedulerScreen = lazy(async () => import("./screens/WorkspaceSchedulerScreen").then((module) => ({
  default: module.WorkspaceSchedulerScreen,
})));
const WorkspaceExportScreen = lazy(async () => import("./screens/WorkspaceExportScreen").then((module) => ({
  default: module.WorkspaceExportScreen,
})));
const WorkspaceSettingsScreen = lazy(async () => import("./screens/WorkspaceSettingsScreen").then((module) => ({
  default: module.WorkspaceSettingsScreen,
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

export function AppShell(): ReactElement {
  const { t, formatDateTime } = useI18n();
  const {
    sessionLoadState,
    sessionVerificationState,
    isSessionVerified,
    sessionErrorMessage,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    isSyncing,
    errorMessage,
    initialize,
    chooseWorkspace,
    createWorkspace,
    cloudSettings,
  } = useAppData();
  const [isAccountDeletionPendingState, setIsAccountDeletionPendingState] = useState<boolean>(isAccountDeletionPending);
  const [accountDeletionErrorMessage, setAccountDeletionErrorMessage] = useState<string>("");
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState<boolean>(false);
  const sessionRestoringMessage = sessionVerificationState === "unverified" ? t("loading.restoringSession") : "";
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");
  const activeWorkspaceName: string | null = activeWorkspace?.name ?? null;
  const activeWorkspaceLabel: string = activeWorkspaceName ?? t("app.workspaceUnavailable");

  const completeAccountDeletion = useCallback(async function completeAccountDeletion(): Promise<void> {
    if (isSessionVerified === false) {
      return;
    }

    setIsAccountDeletionSubmitting(true);
    setAccountDeletionErrorMessage("");

    try {
      const persistedCsrfToken = loadAccountDeletionCsrfToken();
      if (persistedCsrfToken !== null) {
        primeSessionCsrfToken(persistedCsrfToken);
      }
      await deleteMyAccount(deleteAccountConfirmationText);
      await clearAllLocalBrowserData();
      window.location.href = buildLogoutLocalUrl();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACCOUNT_DELETED") {
        await clearAllLocalBrowserData();
        window.location.href = buildLogoutLocalUrl();
        return;
      }

      setAccountDeletionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAccountDeletionSubmitting(false);
    }
  }, [isSessionVerified]);

  useEffect(() => subscribeToAccountDeletionPending(() => {
    setIsAccountDeletionPendingState(isAccountDeletionPending());
  }), []);

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
          {accountDeletionErrorMessage !== "" ? <p className="error-banner">{accountDeletionErrorMessage}</p> : null}
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
          <p className="error-banner">{sessionErrorMessage}</p>
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
          <a className="primary-btn" href={buildLoginUrl(window.location.origin, getPreferredAuthUiLocale())}>
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
          {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
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
                  <span className="brand-full">flashcards-open-source-app</span>
                  <span className="brand-short">flashcards</span>
                </a>
                {isSyncing ? <span className="topbar-sync-status">{t("app.syncing")}</span> : null}
                {!isSyncing && sessionRestoringMessage !== "" ? <span className="topbar-sync-status">{sessionRestoringMessage}</span> : null}
              </div>
              <span data-testid="topbar-active-workspace-value" hidden>{activeWorkspaceName ?? ""}</span>
              <p className="topbar-workspace" data-testid="topbar-active-workspace" data-workspace-name={activeWorkspaceName ?? ""}>
                {activeWorkspaceLabel}
              </p>
            </div>
            <nav className="nav" aria-label={t("shell.primaryNavigation")}>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={reviewRoute}>
                {t("navigation.review")}
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={cardsRoute}>
                {t("navigation.cards")}
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={chatRoute}>
                {t("navigation.aiChat")}
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={settingsHubRoute}>
                {t("navigation.settings")}
              </NavLink>
            </nav>
            <div className="topbar-actions">
              <AccountMenu
                workspaces={availableWorkspaces}
                currentWorkspaceId={activeWorkspace?.workspaceId ?? ""}
                currentWorkspaceName={activeWorkspace?.name ?? t("common.unavailable")}
                isBusy={isChoosingWorkspace}
                isWorkspaceManagementLocked={isWorkspaceLocked}
                workspaceManagementLockedMessage={workspaceManagementLockedMessage}
                accountSettingsUrl={accountSettingsRoute}
                logoutUrl={buildLogoutUrl()}
                onSelectWorkspace={chooseWorkspace}
                onCreateWorkspace={createWorkspace}
              />
            </div>
          </div>
        </header>
      </div>
      {errorMessage !== "" ? (
        <div className="global-error-wrap">
          <div className="global-error">{errorMessage}</div>
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
        <Routes>
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
          <Route path={settingsHubRoute} element={renderDeferredRoute(<SettingsScreen />, "loading.settings")} />
          <Route
            path={settingsCurrentWorkspaceRoute}
            element={renderDeferredRoute(<CurrentWorkspaceScreen />, "loading.currentWorkspace")}
          />
          <Route path={settingsAccessRoute} element={renderDeferredRoute(<AccessSettingsScreen />, "loading.accessSettings")} />
          <Route path={settingsAccessDetailRoutePattern} element={renderDeferredRoute(<AccessPermissionDetailScreen />, "loading.accessDetails")} />
          <Route path={workspaceSettingsRoute} element={renderDeferredRoute(<WorkspaceSettingsScreen />, "loading.workspaceSettings")} />
          <Route path={settingsNotificationsRoute} element={renderDeferredRoute(<NotificationsSettingsScreen />, "loading.notificationSettings")} />
          <Route path={settingsOverviewRoute} element={renderDeferredRoute(<WorkspaceOverviewScreen />, "loading.workspaceOverview")} />
          <Route path={settingsSchedulerRoute} element={renderDeferredRoute(<WorkspaceSchedulerScreen />, "loading.schedulerSettings")} />
          <Route path={settingsExportRoute} element={renderDeferredRoute(<WorkspaceExportScreen />, "loading.exportSettings")} />
          <Route path={settingsDecksRoute} element={renderDeferredRoute(<DecksScreen />, "loading.decks")} />
          <Route path={settingsDeckNewRoute} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${settingsDecksRoute}/:deckId/edit`} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${settingsDecksRoute}/:deckId`} element={renderDeferredRoute(<DeckDetailScreen />, "loading.deckDetails")} />
          <Route path={settingsTagsRoute} element={renderDeferredRoute(<TagsScreen />, "loading.tags")} />
          <Route path={settingsDeviceRoute} element={renderDeferredRoute(<ThisDeviceSettingsScreen />, "loading.deviceDetails")} />
          <Route path={accountSettingsRoute} element={renderDeferredRoute(<AccountSettingsScreen />, "loading.accountSettings")} />
          <Route path={accountStatusRoute} element={renderDeferredRoute(<AccountStatusScreen />, "loading.accountStatus")} />
          <Route path={accountLegalSupportRoute} element={renderDeferredRoute(<LegalSupportScreen />, "loading.legalSupport")} />
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
        </Routes>
      </div>
      {!isFullscreenChat && !isOpen ? <ChatToggle /> : null}
    </div>
  );
}

export default function App(): ReactElement {
  return (
    <AppDataProvider>
      <ChatLayoutProvider>
        <ChatSessionControllerProvider>
          <ChatDraftProvider>
            <BrowserRouter>
              <AppShell />
            </BrowserRouter>
          </ChatDraftProvider>
        </ChatSessionControllerProvider>
      </ChatLayoutProvider>
    </AppDataProvider>
  );
}
