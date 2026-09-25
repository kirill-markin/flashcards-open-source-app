import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes as RouterRoutes, useLocation, useNavigate, useParams } from "react-router";
import { AccountMenu } from "./AccountMenu";
import { AccountDeletionRecoveryGate } from "./accountDeletionRecovery";
import {
  AnalyticsConsentBanner,
  AnalyticsLifecycle,
  PublicAnalyticsConsentLink,
  publishAnalyticsRootGate,
  type AnalyticsRootGate,
} from "./analytics";
import {
  AppDataProvider,
  isEntryWorkspaceUnavailable,
  subscribeToEntryWorkspaceActivation,
  useAppData,
  type SessionLoadState,
} from "./appData";
import { AppErrorDialogProvider } from "./appError/AppErrorContext";
import { HeaderStoreButtons } from "./appPlatformLinks";
import { buildLoginUrl, buildLogoutUrl } from "./api";
import { ChatDraftProvider } from "./chat/composer/drafts/ChatDraftContext";
import { ChatLayoutProvider, useChatLayout } from "./chat/layout/ChatLayoutContext";
import { ChatSessionControllerProvider } from "./chat/sessionController";
import { ChatToggle } from "./chat/layout/ChatToggle";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss, type AnchoredFloatingOverlayMinimumWidth } from "./floating";
import { useAppErrorDialog } from "./appError/AppErrorContext";
import { type TranslationKey, useI18n } from "./i18n";
import { AppErrorBoundary, wrapRoutesComponent } from "./observability/instrument";
import { getPublicSiteHomeUrl } from "./publicSiteUrl";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
  accountSupportRoute,
  buildSettingsDeckDetailRoute,
  buildSettingsDeckEditRoute,
  buildWorkspaceRoute,
  catalogImportRoutePattern,
  cardsRoute,
  chatRoute,
  friendInviteRoutePattern,
  friendInvitePreviewIndexRoute,
  friendInvitePreviewRoutePattern,
  normalizeRoutePath,
  progressRoute,
  reviewRoute,
  settingsAccessRoute,
  settingsAccessDetailRoutePattern,
  settingsAIChatSuggestionsRoute,
  settingsAnalyticsRoute,
  settingsOwnOpenAIKeyRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeckNewRoute,
  settingsDecksRoute,
  settingsDeleteCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsExportRoute,
  settingsFeedbackRoute,
  settingsHubRoute,
  settingsImportRoute,
  settingsLanguageRoute,
  settingsLeaderboardParticipationRoute,
  settingsNotificationsRoute,
  settingsReviewAnimationsRoute,
  settingsResetStudyProgressRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
  settingsTagsRoute,
  settingsTestAnimationsRoute,
  settingsTestAppPlatformLinksRoute,
  settingsTestCatalogImportSuccessRoute,
  settingsTestLocalSyncDiagnosticsRoute,
  settingsTestRoute,
  shareRoute,
  splitWorkspaceRoutePath,
  workspaceRoutePattern,
  workspaceRoutePrefix,
} from "./routes";
import { useWorkspacePath } from "./useWorkspacePath";
import { isWorkspaceManagementLocked } from "./workspaceManagement";
import { TestModeProvider, useTestMode } from "./testMode";
import { AIChatPreferencesProvider } from "./chat/preferences/AIChatPreferencesContext";
import { CardFormScreen } from "./screens/cards/form/CardFormScreen";
import { CardsScreen } from "./screens/cards/list/CardsScreen";
import { FriendInviteScreen } from "./screens/invite/FriendInviteScreen";
import { ProgressScreen } from "./screens/progress/ProgressScreen";
import { ReviewScreen } from "./screens/review/ReviewScreen";
import { ShareAppScreen } from "./screens/share/ShareAppScreen";

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

const mobileNavigationViewportPaddingPx: number = 12;
const mobileNavigationOffsetPx: number = 8;
const mobileNavigationMaxHeightPx: number = 420;
const mobileNavigationMinimumWidth: AnchoredFloatingOverlayMinimumWidth = { kind: "reference" };
const mobileNavigationFirstLinkSelector: string = "a[href]";

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
const AIChatSuggestionsSettingsScreen = lazy(async () => import("./screens/settings/AIChatSuggestionsSettingsScreen").then((module) => ({
  default: module.AIChatSuggestionsSettingsScreen,
})));
const OwnOpenAIKeySettingsScreen = lazy(async () => import("./screens/settings/OwnOpenAIKeySettingsScreen").then((module) => ({
  default: module.OwnOpenAIKeySettingsScreen,
})));
const AnalyticsSettingsScreen = lazy(async () => import("./screens/settings/AnalyticsSettingsScreen").then((module) => ({
  default: module.AnalyticsSettingsScreen,
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
const TestAppPlatformLinksScreen = lazy(async () => import("./screens/settings/TestAppPlatformLinksScreen").then((module) => ({
  default: module.TestAppPlatformLinksScreen,
})));
const TestCatalogImportSuccessScreen = lazy(async () => import("./screens/settings/TestAppPlatformLinksScreen").then((module) => ({
  default: module.TestCatalogImportSuccessScreen,
})));
const TestLocalSyncDiagnosticsScreen = lazy(async () => import("./screens/settings/TestSettingsScreen").then((module) => ({
  default: module.TestLocalSyncDiagnosticsScreen,
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
const WorkspaceExportScreen = lazy(async () => import("./screens/settings/workspace/packages/WorkspaceExportScreen").then((module) => ({
  default: module.WorkspaceExportScreen,
})));
const WorkspaceImportScreen = lazy(async () => import("./screens/settings/workspace/packages/WorkspaceImportScreen").then((module) => ({
  default: module.WorkspaceImportScreen,
})));
const CatalogImportScreen = lazy(async () => import("./screens/catalog/CatalogImportScreen").then((module) => ({
  default: module.CatalogImportScreen,
})));

function RouteContentFallback(props: Readonly<{ messageKey: TranslationKey }>): ReactElement {
  const { messageKey } = props;
  const { t } = useI18n();

  return (
    <main className="container">
      <section className="panel panel-center state-panel">
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

/**
 * Every path the app served before it moved under `/w/:workspaceId`, forwarded to the same path in
 * the active workspace with its `search` and `hash` intact. It stays permanently: external bookmarks
 * and the in-app links that still point at flat paths both arrive here. `/` is the one path whose
 * target differs, because there is no workspace-relative screen at the site root.
 *
 * A path already addressed under `/w` is left where it is, so a deep link no `<Route>` above matches
 * renders nothing, the way an unmatched path does today, instead of being prefixed twice. The second
 * half of that test is wider than `splitWorkspaceRoutePath` on purpose: a path whose segment this
 * build rejects reaches here only when the shell's forwarding branch rejected it too, which is the
 * divergence case that branch falls through on, and prefixing it again would grow the address on
 * every render instead of resting on a blank content area.
 */
function LegacyFlatPathRedirect(): ReactElement {
  const location = useLocation();
  const { activeWorkspace } = useAppData();
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;

  const normalizedPathname: string = normalizeRoutePath(location.pathname);
  if (
    splitWorkspaceRoutePath(location.pathname).workspaceId !== null
    || normalizedPathname === workspaceRoutePrefix
    || normalizedPathname.startsWith(`${workspaceRoutePrefix}/`)
  ) {
    return <></>;
  }

  if (activeWorkspaceId === null) {
    return <RouteContentFallback messageKey="loading.generic" />;
  }

  const appPath: string = normalizedPathname === "/" ? reviewRoute : location.pathname;
  return <Navigate replace to={`${buildWorkspaceRoute(activeWorkspaceId, appPath)}${location.search}${location.hash}`} />;
}

/**
 * The app path carried under a `/w/<segment>` whose segment is not a workspace id.
 * `splitWorkspaceRoutePath` hands such a path back unsplit, because it reports the workspace it could
 * read rather than the shape it matched, so the segment is dropped here instead. Sliced out of the
 * raw pathname, which keeps a case-sensitive token in the remainder intact, and `/` becomes the
 * review screen for the same reason it does in `LegacyFlatPathRedirect`: no screen sits at the root.
 */
function readUnrecognisedWorkspaceAppPath(pathname: string): string {
  const afterPrefix: string = pathname.slice(workspaceRoutePrefix.length + 1);
  const appPathStart: number = afterPrefix.indexOf("/");
  const appPath: string = appPathStart === -1 ? "/" : afterPrefix.slice(appPathStart);
  return appPath === "/" ? reviewRoute : appPath;
}

function TestModeRouteGuard(props: Readonly<{ children: ReactElement }>): ReactElement {
  const { children } = props;
  const { isTestModeEnabled } = useTestMode();

  if (isTestModeEnabled === false) {
    return <Navigate replace to={settingsHubRoute} />;
  }

  return children;
}

/**
 * The gate the shell below puts on display in place of the whole app, beyond the ones
 * `SessionLoadState` names. A separate argument rather than a member of that type: an address naming
 * a workspace the account cannot open is a product condition rather than a state of loading the
 * session, and `SessionLoadState` is spread across `appData`, its provider and the test helpers.
 */
type WorkspaceRootGateState = "workspace_unavailable" | "none";

/**
 * What a gate that replaces the app root reports, and the only place it is decided: `Analytics-
 * Lifecycle` reports this and nothing else while a gate is up, so a gate added to the shell below
 * answers here rather than leaving the route's screen reported and taking its surface down
 * afterwards.
 *
 * The workspace-unavailable panel reports no screen at all — no value in the closed cross-client
 * `screen` enum names it — and it takes the route's surface down with it, so nothing tracked while
 * it stands is filed against the route whose screen it kept from rendering.
 *
 * Answered before the session states although the shell renders this panel after them, which changes
 * nothing: it is reachable only at `ready`, so the two can never both be up. Exhaustive over
 * `WorkspaceRootGateState` the way the session switch below is exhaustive over `SessionLoadState`,
 * and for the same reason: `"none"` returns the session's answer rather than falling out of the
 * switch, so a gate added to this type fails to compile until it says what it reports.
 */
function resolveRootGateReport(
  sessionLoadState: SessionLoadState,
  workspaceGateState: WorkspaceRootGateState,
): AnalyticsRootGate {
  switch (workspaceGateState) {
    case "workspace_unavailable":
      return { status: "gated", surface: null };
    case "none":
      return resolveSessionRootGateReport(sessionLoadState);
  }
}

/**
 * `selecting_workspace` replaces everything with the workspace chooser, and the catalog is explicit
 * that the choice is part of the sign-in screen: "the email step, the code step and the workspace
 * choice are one screen here". The steps themselves live on the auth service's origin, so this is
 * the only part of `signin` this client can ever report.
 *
 * `deleted` replaces everything with a gate whose only exit is signing in again, reached on the boot
 * that finds the account behind the stored session gone. That is `credential_recovery`: the app root
 * taken over because stored credentials can no longer be used, which is what iOS and Android report
 * it for (`CloudCredentialRecoveryReason.linkedCredentialsMissing` and its siblings). It is not
 * `signin`, which names the sign-in steps themselves, and this gate hosts none of them.
 *
 * The session's own loading, redirect and error panels report no screen either — no value in the
 * enum names one of them — and they leave the stamp exactly where the route set it on the first
 * commit, which is where the catalog keeps a route's own loading and error states. A `warm`
 * `app_opened` from a tab return during a slow load, and everything else tracked while one of them
 * is up, still carries the route's surface, as it did before any of this was published.
 *
 * `ready` is the route's own screen showing, and it reports itself.
 *
 * Exhaustive over `SessionLoadState` with no `default`, the way `productAnalyticsClientReportable-
 * PlatformFlags` is exhaustive over its stored domain in `apps/backend/src/productAnalytics/
 * catalog.ts`, and for the same reason: a new gate state must not report a screen — or silently
 * report none — by omission, because `analytics.product_events` is append-only and has no repair
 * path. Adding one fails to compile here until this question is answered for it.
 */
function resolveSessionRootGateReport(sessionLoadState: SessionLoadState): AnalyticsRootGate {
  switch (sessionLoadState) {
    case "selecting_workspace":
      return { status: "gated", surface: "signin" };
    case "deleted":
      return { status: "gated", surface: "credential_recovery" };
    case "loading":
    case "redirecting":
    case "error":
    // A browser without storage also has no analytics queue to record a screen view into.
    case "storage_unavailable":
      return { status: "gated_keeping_route_stamp" };
    case "ready":
      return { status: "open" };
  }
}

export function AppShell(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, t, formatDateTime } = useI18n();
  const {
    sessionLoadState,
    sessionVerificationState,
    isSessionVerified,
    sessionErrorMessage,
    sessionTechnicalError,
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
  const workspacePath = useWorkspacePath();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState<boolean>(false);
  const topbarShellRef = useRef<HTMLElement | null>(null);
  const mobileNavigationToggleRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavigationMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionRestoringMessage = sessionVerificationState === "unverified" ? t("loading.restoringSession") : "";
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;
  const activeWorkspaceName: string | null = activeWorkspace?.name ?? null;
  const { workspaceId: urlWorkspaceId, appPath: urlAppPath } = splitWorkspaceRoutePath(location.pathname);
  // The address the browser is at, in the shape every target below is built in, so a target that
  // would navigate nowhere can be recognised as one.
  const currentAddress: string = `${location.pathname}${location.search}${location.hash}`;
  // `splitWorkspaceRoutePath` lowercases the segment it reads while `buildWorkspaceRoute` keeps the
  // id as given, so the two are only ever comparable case-insensitively.
  const isUrlWorkspaceActive: boolean = urlWorkspaceId !== null
    && activeWorkspaceId?.toLowerCase() === urlWorkspaceId;
  // The address this document was opened on named a workspace the account's own list does not hold,
  // which `resolveInitialWorkspace` recorded on the entry-address model while it fell back to the
  // account default (`appData/session/activation/workspaceActivationHelpers.ts`). Read from there
  // rather than from `location.pathname`, which is the app's own output — `LegacyFlatPathRedirect`
  // rewrites a flat path into `/w/<active workspace>/…` inside this same document — so a gate keyed
  // on the live address would raise this panel for someone who opened the app normally and followed
  // no link. A workspace deleted while it was on screen was activated rather than recorded
  // unavailable, so that case leaves through the alignment below instead of through a panel about
  // what the user just did.
  //
  // `ready` on top of the record, because the record is written before the account default is
  // activated: evaluating it any earlier would take the route's analytics surface down during the
  // loading window, with no gate on screen to replace it, and `ready` is the only state that renders
  // one at all.
  //
  // Subscribed rather than called in render: the record is module state, and reading it bare would
  // leave this gate right only while every writer of that record happens to update session state in
  // the same breath.
  const isEntryWorkspaceRecordedUnavailable: boolean = useSyncExternalStore(
    subscribeToEntryWorkspaceActivation,
    isEntryWorkspaceUnavailable,
  );
  // The published workspace has to have moved off the one the address names as well. The record is
  // written the moment the account's list is found not to hold the entry workspace, and the fallback
  // that publishes the account default is an IndexedDB write or an HTTP round trip later, so between
  // the two this panel would stand with the entry workspace still active: its only exit is a
  // document load onto the active workspace's own review screen, which would land straight back on
  // it, and the gate report below would start inside that window. `ready` keeps that report
  // out of that window only on a cold start, where the session is still loading while the record is
  // written; on a warm start the session is already `ready` and is held there across
  // `listWorkspaces`, so the whole window sits inside `ready` and the published workspace is the
  // only thing left to test. Once the fallback publishes, the active workspace is the account
  // default and the two differ again. This rests on the URL continuing to name the entry workspace
  // until the fallback publishes, so a future mover of the workspace segment that does not retire
  // the entry address would suppress this panel permanently rather than transiently.
  const isEntryWorkspaceUnreachable: boolean = sessionLoadState === "ready"
    && isEntryWorkspaceRecordedUnavailable
    && isUrlWorkspaceActive === false;
  // The active workspace moves away from the one the URL names when the account switches workspaces
  // or deletes the one it was in, and the address has to go with it: reloading the stale URL would
  // otherwise hand back the workspace that was just left.
  const alignedWorkspaceUrl: string | null = urlWorkspaceId !== null
    && activeWorkspaceId !== null
    && isUrlWorkspaceActive === false
    // The panel below is about the address itself, so realigning it would erase what is being
    // reported and leave the panel standing over an address that no longer names its workspace.
    // While the panel is held down waiting for the account default to be published, this guard is
    // open, and it is the `isUrlWorkspaceActive` test above that keeps the realignment off that
    // address: the entry workspace is both what the URL names and what is still active there.
    && isEntryWorkspaceUnreachable === false
    ? `${buildWorkspaceRoute(activeWorkspaceId, urlAppPath)}${location.search}${location.hash}`
    : null;
  // A replace onto the address already showing is a no-op at best and a loop at worst, so a target
  // equal to the current address is dropped instead of navigated. It cannot arise today — the
  // workspace the URL names differs from the active one here, by construction — but the guard keeps
  // that a property of this line rather than of a comparison two definitions away.
  const staleWorkspaceUrl: string | null = alignedWorkspaceUrl === currentAddress ? null : alignedWorkspaceUrl;
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

  const selectInitialWorkspace = useCallback(async function selectInitialWorkspace(workspaceId: string): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      await chooseWorkspace(workspaceId);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      throw error;
    }
  }, [chooseWorkspace, indexedDbOpenRecoveryState]);

  const closeMobileNavigation = useCallback(function closeMobileNavigation(): void {
    setIsMobileNavigationOpen(false);
  }, []);

  const focusFirstMobileNavigationLink = useCallback(function focusFirstMobileNavigationLink(): void {
    const mobileNavigationMenu = mobileNavigationMenuRef.current;
    if (mobileNavigationMenu === null) {
      return;
    }

    const firstVisibleLink = Array.from(mobileNavigationMenu.querySelectorAll<HTMLElement>(mobileNavigationFirstLinkSelector))
      .find((element) => element.getClientRects().length > 0) ?? null;
    firstVisibleLink?.focus();
  }, []);

  const closeMobileNavigationAndFocusToggle = useCallback(function closeMobileNavigationAndFocusToggle(): void {
    closeMobileNavigation();
    mobileNavigationToggleRef.current?.focus();
  }, [closeMobileNavigation]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef: mobileNavigationToggleRef,
    overlayRef: mobileNavigationMenuRef,
    enabled: isMobileNavigationOpen,
    onClose: closeMobileNavigation,
  });

  useEffect(() => {
    if (isMobileNavigationOpen === false) {
      return;
    }

    focusFirstMobileNavigationLink();
  }, [focusFirstMobileNavigationLink, isMobileNavigationOpen]);

  useEffect(() => {
    closeMobileNavigation();
  }, [closeMobileNavigation, location.pathname]);

  useEffect(() => {
    if (isMobileNavigationOpen === false) {
      return undefined;
    }

    function closeMobileNavigationOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMobileNavigationAndFocusToggle();
      }
    }

    window.addEventListener("keydown", closeMobileNavigationOnEscape);

    return () => {
      window.removeEventListener("keydown", closeMobileNavigationOnEscape);
    };
  }, [closeMobileNavigationAndFocusToggle, isMobileNavigationOpen]);

  function toggleMobileNavigation(): void {
    setIsMobileNavigationOpen((currentValue: boolean): boolean => !currentValue);
  }

  // Navigated from an effect rather than by returning `<Navigate>` in place of the shell: returning
  // it unmounts the topbar and the current screen for the commit the navigation takes, so a blank
  // frame can paint on a workspace switch or a workspace delete, both of which have to feel
  // instantaneous. Every screen reads `activeWorkspace` rather than the URL, so the frame that
  // renders under the stale address is already showing the workspace being moved to.
  useEffect(() => {
    if (staleWorkspaceUrl === null) {
      return;
    }

    navigate(staleWorkspaceUrl, { replace: true });
  }, [navigate, staleWorkspaceUrl]);

  // Resolved and published before the early returns below, so it runs on every render as a hook
  // must and so every gate this shell renders reaches the reporting mechanism rather than only the
  // ones that remember to report themselves. `AnalyticsLifecycle` reports what this says, and for
  // the workspace-unavailable gate that is also what keeps the events tracked underneath off the
  // route's surface: `resolveAnalyticsSurface` reads `review` off `/w/<unreachable>/review` — the
  // workspace segment is stripped before the route is classified — and that surface would otherwise
  // stand under a screen that never rendered.
  const rootGateReport: AnalyticsRootGate = resolveRootGateReport(
    sessionLoadState,
    isEntryWorkspaceUnreachable ? "workspace_unavailable" : "none",
  );
  useEffect(() => {
    publishAnalyticsRootGate(rootGateReport);
  }, [rootGateReport]);

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

  if (sessionLoadState === "storage_unavailable") {
    // No retry button: the browser exposes no storage at all, so another attempt fails identically.
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.title")}</h1>
          <h2 className="panel-subtitle">{t("appError.storageUnavailable.title")}</h2>
          <p className="error-banner">{t("appError.storageUnavailable.message")}</p>
          <p className="subtitle">{t("appError.storageUnavailable.guidance")}</p>
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
                className="workspace-choice-btn"
                type="button"
                onClick={() => void selectInitialWorkspace(workspace.workspaceId)}
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

  // Placed after the session gates above, so the workspace picker wins while it is up: an account
  // with no stored selection reaches `selecting_workspace` with this record already written, and
  // choosing there retires the entry address rather than being answered with this panel.
  //
  // The exit is the workspace this session did activate, which is the account's own server-side
  // default — reaching this state means the entry address named something absent from the account's
  // list, so `resolveInitialWorkspace` fell through to that selection. It also covers an address
  // left over from a previous account on this browser, which lands the account that signed in on its
  // own review screen rather than nowhere. A document load rather than a `Link`, because the entry
  // address is what decides the workspace and it is captured once per document: a client-side
  // navigation would leave this panel standing.
  if (isEntryWorkspaceUnreachable) {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.title")}</h1>
          <p className="subtitle">{t("app.workspaceUnavailable")}</p>
          {activeWorkspaceId === null ? null : (
            <a className="primary-btn" href={buildWorkspaceRoute(activeWorkspaceId, reviewRoute)}>
              {t("navigation.review")}
            </a>
          )}
        </section>
      </main>
    );
  }

  // `workspaceRoutePattern` matches any first segment while `splitWorkspaceRoutePath` accepts only a
  // workspace id (`workspaceIdPattern`), so `/w/<garbage>/review` renders `ReviewScreen` under an
  // address that names no workspace, and the `/*` legacy redirect inside `RoutedShell` never sees
  // it. One predicate has to decide what a workspace segment is: a path carrying an unrecognised one
  // names no workspace, so it is forwarded the way a flat path is, onto the same screen in the
  // active workspace. Returned rather than navigated from an effect, unlike the alignment above:
  // there is no shell standing here to keep, and a screen nothing downstream can classify should not
  // mount at all.
  //
  // `/w` and `/w/` carry no segment at all and normalize to the bare prefix, so they are matched
  // separately from the paths that carry one: this branch is the only thing that forwards them,
  // because `LegacyFlatPathRedirect` declines everything already under the prefix and no `<Route>`
  // matches the bare prefix either, so without it they would rest on a blank content area.
  const normalizedPathname: string = normalizeRoutePath(location.pathname);
  if (
    urlWorkspaceId === null
    && activeWorkspaceId !== null
    && (normalizedPathname === workspaceRoutePrefix || normalizedPathname.startsWith(`${workspaceRoutePrefix}/`))
  ) {
    const workspaceAppPath: string = readUnrecognisedWorkspaceAppPath(location.pathname);
    const workspaceUrl: string = `${buildWorkspaceRoute(activeWorkspaceId, workspaceAppPath)}${location.search}${location.hash}`;

    // Forwarding to the address already showing would be a fixed point, and this `<Navigate>` stands
    // in place of the entire shell: the account would see a blank page on every route, or a replace
    // loop, with no client-side way out because the workspace id comes from the server. It cannot
    // happen while `workspaceIdPattern` matches the platform contract, since the only way in is a
    // target this branch's own predicate rejects; if the two ever diverge again, falling through
    // hands the address to `LegacyFlatPathRedirect`, which declines everything already under the
    // workspace prefix, so it degrades to today's blank content area rather than to a dead app or a
    // redirect loop that grows the URL.
    if (workspaceUrl !== currentAddress) {
      return <Navigate replace to={workspaceUrl} />;
    }
  }

  return (
    <div className="app-shell">
      <div className="header-sticky">
        <header ref={topbarShellRef} className="topbar-shell">
          <div className="topbar">
            <div className="topbar-brand-block">
              <div className="topbar-brand-row">
                <a className="topbar-brand" href={getPublicSiteHomeUrl(locale)} rel="noreferrer" target="_blank">
                  <span className="brand-full">Nibomo</span>
                  <span className="brand-short">Nibomo</span>
                </a>
                <HeaderStoreButtons />
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
                <NavLink key={item.route} className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={workspacePath(item.route)}>
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </nav>
            <div className="topbar-actions">
              <button
                ref={mobileNavigationToggleRef}
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
                accountSettingsUrl={workspacePath(settingsHubRoute)}
                logoutUrl={buildLogoutUrl()}
                onSelectWorkspace={chooseWorkspace}
                onCreateWorkspace={createWorkspace}
              />
            </div>
          </div>
          <AnchoredFloatingOverlay
            isOpen={isMobileNavigationOpen}
            referenceRef={topbarShellRef}
            floatingRef={mobileNavigationMenuRef}
            placement="bottom-start"
            viewportPaddingPx={mobileNavigationViewportPaddingPx}
            offsetPx={mobileNavigationOffsetPx}
            minimumWidth={mobileNavigationMinimumWidth}
            maxWidthPx={null}
            maxHeightPx={mobileNavigationMaxHeightPx}
            className="mobile-nav-menu"
            id="mobile-primary-navigation"
            role="navigation"
            ariaLabel={t("shell.primaryNavigation")}
            ariaLabelledBy={null}
            ariaDescribedBy={null}
            ariaModal={null}
          >
            {primaryNavigationItems.map((item) => (
              <NavLink
                key={item.route}
                className={({ isActive }) => `mobile-nav-link${isActive ? " mobile-nav-link-active" : ""}`}
                to={workspacePath(item.route)}
                onClick={closeMobileNavigation}
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </AnchoredFloatingOverlay>
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
  const isFullscreenChat = normalizeRoutePath(splitWorkspaceRoutePath(location.pathname).appPath) === chatRoute;
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
          <Route path={workspaceRoutePattern} element={<Navigate replace to={reviewRoute} />} />
          <Route path={`${workspaceRoutePattern}${cardsRoute}`} element={<CardsScreen />} />
          <Route path={`${workspaceRoutePattern}${cardsRoute}/new`} element={<CardFormScreen />} />
          <Route path={`${workspaceRoutePattern}${cardsRoute}/:cardId`} element={<CardFormScreen />} />
          <Route path={`${workspaceRoutePattern}/decks`} element={<Navigate replace to={settingsDecksRoute} />} />
          <Route path={`${workspaceRoutePattern}/decks/new`} element={<Navigate replace to={settingsDeckNewRoute} />} />
          <Route path={`${workspaceRoutePattern}/decks/:deckId/edit`} element={<LegacyDeckEditRedirect />} />
          <Route path={`${workspaceRoutePattern}/decks/:deckId`} element={<LegacyDeckDetailRedirect />} />
          <Route path={`${workspaceRoutePattern}/tags`} element={<Navigate replace to={settingsTagsRoute} />} />
          <Route path={`${workspaceRoutePattern}${reviewRoute}`} element={<ReviewScreen />} />
          <Route path={`${workspaceRoutePattern}${progressRoute}`} element={<ProgressScreen />} />
          <Route path={`${workspaceRoutePattern}${settingsHubRoute}`} element={renderDeferredRoute(<SettingsScreen />, "loading.settings")} />
          <Route
            path={`${workspaceRoutePattern}${settingsCurrentWorkspaceRoute}`}
            element={renderDeferredRoute(<CurrentWorkspaceScreen />, "loading.currentWorkspace")}
          />
          <Route path={`${workspaceRoutePattern}${settingsFeedbackRoute}`} element={renderDeferredRoute(<FeedbackSettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsLanguageRoute}`} element={renderDeferredRoute(<LanguageSettingsScreen />, "loading.deviceDetails")} />
          <Route path={`${workspaceRoutePattern}${settingsLeaderboardParticipationRoute}`} element={renderDeferredRoute(<LeaderboardParticipationSettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsServerRoute}`} element={renderDeferredRoute(<ServerSettingsInfoScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsAccessRoute}`} element={renderDeferredRoute(<AccessSettingsScreen />, "loading.accessSettings")} />
          <Route path={`${workspaceRoutePattern}${settingsAccessDetailRoutePattern}`} element={renderDeferredRoute(<AccessPermissionDetailScreen />, "loading.accessDetails")} />
          <Route path={`${workspaceRoutePattern}${settingsNotificationsRoute}`} element={renderDeferredRoute(<NotificationsSettingsScreen />, "loading.notificationSettings")} />
          <Route path={`${workspaceRoutePattern}${settingsReviewAnimationsRoute}`} element={renderDeferredRoute(<ReviewAnimationsSettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsAIChatSuggestionsRoute}`} element={renderDeferredRoute(<AIChatSuggestionsSettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsOwnOpenAIKeyRoute}`} element={renderDeferredRoute(<OwnOpenAIKeySettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsAnalyticsRoute}`} element={renderDeferredRoute(<AnalyticsSettingsScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsSchedulerRoute}`} element={renderDeferredRoute(<WorkspaceSchedulerScreen />, "loading.schedulerSettings")} />
          <Route path={`${workspaceRoutePattern}${settingsImportRoute}`} element={renderDeferredRoute(<WorkspaceImportScreen />, "loading.importSettings")} />
          <Route path={`${workspaceRoutePattern}${settingsExportRoute}`} element={renderDeferredRoute(<WorkspaceExportScreen />, "loading.exportSettings")} />
          <Route path={`${workspaceRoutePattern}${settingsResetStudyProgressRoute}`} element={renderDeferredRoute(<ResetStudyProgressScreen />, "loading.settings")} />
          <Route path={`${workspaceRoutePattern}${settingsDeleteCurrentWorkspaceRoute}`} element={renderDeferredRoute(<DeleteCurrentWorkspaceScreen />, "loading.currentWorkspace")} />
          <Route path={`${workspaceRoutePattern}${settingsDecksRoute}`} element={renderDeferredRoute(<DecksScreen />, "loading.decks")} />
          <Route path={`${workspaceRoutePattern}${settingsDeckNewRoute}`} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${workspaceRoutePattern}${settingsDecksRoute}/:deckId/edit`} element={renderDeferredRoute(<DeckFormScreen />, "loading.deckEditor")} />
          <Route path={`${workspaceRoutePattern}${settingsDecksRoute}/:deckId`} element={renderDeferredRoute(<DeckDetailScreen />, "loading.deckDetails")} />
          <Route path={`${workspaceRoutePattern}${settingsTagsRoute}`} element={renderDeferredRoute(<TagsScreen />, "loading.tags")} />
          <Route path={`${workspaceRoutePattern}${settingsDeviceRoute}`} element={renderDeferredRoute(<ThisDeviceSettingsScreen />, "loading.deviceDetails")} />
          <Route
            path={`${workspaceRoutePattern}${settingsTestRoute}`}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestSettingsScreen />
              </TestModeRouteGuard>
            ), "loading.testSettings")}
          />
          <Route
            path={`${workspaceRoutePattern}${settingsTestAnimationsRoute}`}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestAnimationsScreen />
              </TestModeRouteGuard>
            ), "loading.testAnimations")}
          />
          <Route
            path={`${workspaceRoutePattern}${settingsTestAppPlatformLinksRoute}`}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestAppPlatformLinksScreen />
              </TestModeRouteGuard>
            ), "loading.testAppPlatformLinks")}
          />
          <Route
            path={`${workspaceRoutePattern}${settingsTestCatalogImportSuccessRoute}`}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestCatalogImportSuccessScreen />
              </TestModeRouteGuard>
            ), "loading.testCatalogImportSuccess")}
          />
          <Route
            path={`${workspaceRoutePattern}${settingsTestLocalSyncDiagnosticsRoute}`}
            element={renderDeferredRoute((
              <TestModeRouteGuard>
                <TestLocalSyncDiagnosticsScreen />
              </TestModeRouteGuard>
            ), "loading.testSettings")}
          />
          <Route path={`${workspaceRoutePattern}${accountStatusRoute}`} element={renderDeferredRoute(<AccountStatusScreen />, "loading.accountStatus")} />
          <Route path={`${workspaceRoutePattern}${accountLegalRoute}`} element={renderDeferredRoute(<LegalScreen />, "loading.legal")} />
          <Route path={`${workspaceRoutePattern}${accountSupportRoute}`} element={renderDeferredRoute(<SupportScreen />, "loading.support")} />
          <Route path={`${workspaceRoutePattern}${accountOpenSourceRoute}`} element={renderDeferredRoute(<OpenSourceSettingsScreen />, "loading.openSourceSettings")} />
          <Route path={`${workspaceRoutePattern}${accountAgentConnectionsRoute}`} element={renderDeferredRoute(<AgentConnectionsScreen />, "loading.agentConnections")} />
          <Route path={`${workspaceRoutePattern}${accountDangerZoneRoute}`} element={renderDeferredRoute(<DangerZoneScreen />, "loading.dangerZone")} />
          <Route
            path={`${workspaceRoutePattern}${chatRoute}`}
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
          <Route path="/*" element={<LegacyFlatPathRedirect />} />
        </SentryRoutes>
      </div>
      {!isFullscreenChat && !isOpen ? <ChatToggle /> : null}
    </div>
  );
}

function AuthenticatedApp(): ReactElement {
  return (
    <AppDataProvider>
      <AIChatPreferencesProvider>
        <ChatLayoutProvider>
          <ChatSessionControllerProvider>
            <ChatDraftProvider>
              <AccountDeletionRecoveryGate>
                <AppShell />
              </AccountDeletionRecoveryGate>
            </ChatDraftProvider>
          </ChatSessionControllerProvider>
        </ChatLayoutProvider>
      </AIChatPreferencesProvider>
    </AppDataProvider>
  );
}

export default function App(): ReactElement {
  return (
    <AppErrorBoundary fallback={<AppCrashFallback />}>
      <BrowserRouter>
        <AnalyticsLifecycle />
        {/* Outside the routes, so every surface a visitor can land on asks on the same terms. */}
        <AnalyticsConsentBanner />
        {/* The answer given on a public route has to be takeable back there too, so the withdrawal
            control sits beside the strip that asked. It renders itself only on the routes below,
            and only once the question has been answered. */}
        <PublicAnalyticsConsentLink />
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
              <Route
                path={catalogImportRoutePattern}
                element={renderDeferredRoute(<CatalogImportScreen />, "catalogImport.loading")}
              />
              <Route path={shareRoute} element={<ShareAppScreen />} />
              <Route path="/*" element={<AuthenticatedApp />} />
            </SentryRoutes>
          </TestModeProvider>
        </AppErrorDialogProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
