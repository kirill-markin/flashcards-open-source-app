import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { AdminNavigation } from "../../navigation/AdminNavigation";
import { getUserPath, userPageTabLabels, userPageTabs, type UserPageTab } from "../../routing";
import { ActivityTab } from "./ActivityTab";
import { CardsTab } from "./CardsTab";
import { ChatsTab } from "./ChatsTab";
import { formatInstant } from "./formatInstant";
import { hasAnyProfileData, loadUserProfile, type UserProfile } from "./profileQuery";
import { ProfileTab } from "./ProfileTab";
import "./userPage.css";

type ProfileLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; profile: UserProfile }>;

/**
 * One person by id. The profile query also feeds the header, so it is loaded once per id whichever
 * tab is open; every other tab loads its own rows. A tab stays mounted once opened and is only hidden
 * while another is shown, so coming back to it keeps its rows and table state without a refetch. The
 * caller keys this page on the id.
 */
export function UserPage(props: Readonly<{
  config: AdminAppConfig;
  adminEmail: string;
  userId: string;
  tab: UserPageTab;
  /** The chat open on the Chats tab, or null for its list. */
  openChatSessionId: string | null;
  /** The Users list path with the query string it was left with. */
  usersListPath: string;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<ProfileLoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [openedTabs, setOpenedTabs] = useState<ReadonlyArray<UserPageTab>>([props.tab]);
  // While another tab is shown, the hidden Chats tab keeps the chat it last showed, so Back to that
  // chat finds it still loaded.
  const [chatsTabSessionId, setChatsTabSessionId] = useState<string | null>(props.openChatSessionId);
  // Both are recorded while rendering rather than in an effect, so the tab they change renders right.
  if (!openedTabs.includes(props.tab)) {
    setOpenedTabs([...openedTabs, props.tab]);
  }
  if (props.tab === "chats" && props.openChatSessionId !== chatsTabSessionId) {
    setChatsTabSessionId(props.openChatSessionId);
  }

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadUserProfile(config, userId).then((profile) => {
      if (!cancelled) setLoadState({ status: "ready", profile });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected user profile query error." });
    });
    return () => { cancelled = true; };
  }, [config, userId, onTerminalAdminError, revision]);

  const profile = loadState.status === "ready" ? loadState.profile : null;
  const isNotFound = profile !== null && !hasAnyProfileData(profile);

  function renderTab(tab: UserPageTab): ReactNode {
    switch (tab) {
      case "profile":
        if (loadState.status === "loading") return <p className="report-state" aria-live="polite">Loading profile…</p>;
        if (loadState.status === "ready") return <ProfileTab profile={loadState.profile} onNavigate={props.onNavigate} />;
        return null;
      case "activity":
        return <ActivityTab config={config} userId={userId} onTerminalAdminError={onTerminalAdminError} />;
      case "chats":
        return (
          <ChatsTab
            config={config}
            userId={userId}
            openSessionId={chatsTabSessionId}
            onNavigate={props.onNavigate}
            onTerminalAdminError={onTerminalAdminError}
          />
        );
      case "cards":
        return <CardsTab config={config} userId={userId} onTerminalAdminError={onTerminalAdminError} />;
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <AdminLink className="user-page-back" path={props.usersListPath} testId="user-page-back" onNavigate={props.onNavigate}>← Users</AdminLink>
        <div>
          <p className="eyebrow">Admin · User</p>
          <h1 data-testid="user-page-title">{profile === null ? "User" : profile.header.email ?? "(no email)"}</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge" data-testid="user-page-id">User ID {userId}</span>
          {profile !== null ? <span className="hero-badge">{profile.header.kind ?? "unknown kind"}</span> : null}
          {profile !== null && profile.header.exclusionReason !== null
            ? <span className="hero-badge user-page-excluded-badge" data-testid="user-page-excluded">Excluded: {profile.header.exclusionReason}</span>
            : null}
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">All dates and times in UTC</span>
          {profile !== null ? <span className="hero-badge">Generated {profile.generatedAtUtc}</span> : null}
        </div>
      </section>

      <AdminNavigation activePage="users" onNavigate={props.onNavigate} />

      <section className="dashboard-section" data-testid="user-page-section">
        {profile !== null && profile.header.mergedInto !== null ? (
          <div className="report-state report-state-warning user-page-merged-banner" data-testid="user-page-merged-into">
            <span>
              Merged into{" "}
              <AdminLink
                className="data-table-link"
                path={getUserPath(profile.header.mergedInto.userId, "profile")}
                testId="user-page-merged-into-link"
                onNavigate={props.onNavigate}
              >{profile.header.mergedInto.email ?? profile.header.mergedInto.userId}</AdminLink>
              {" "}on {formatInstant(profile.header.mergedInto.mergedAt)}.
            </span>
          </div>
        ) : null}

        <nav className="analytics-navigation user-page-tabs" aria-label="User sections">
          {userPageTabs.map((tab) => (
            <AdminLink
              key={tab}
              testId={`user-page-${tab}-tab`}
              className={props.tab === tab ? "active" : ""}
              path={getUserPath(userId, tab)}
              ariaCurrent={props.tab === tab ? "page" : undefined}
              onNavigate={props.onNavigate}
            >{userPageTabLabels[tab]}</AdminLink>
          ))}
        </nav>

        {/* Shown on every tab, because the header it also feeds is on every tab. */}
        {loadState.status === "error" ? (
          <div className="report-state report-state-error">
            <strong>User profile query failed.</strong><span>{loadState.message}</span>
            <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
          </div>
        ) : null}

        {isNotFound ? (
          <div className="report-state" data-testid="user-page-not-found">
            <strong>No user matches this id.</strong>
            <span>No settings row, sign-in identity, guest session, analytics event, workspace, device, billing, community or feedback row names {userId}.</span>
          </div>
        ) : userPageTabs.filter((tab) => openedTabs.includes(tab)).map((tab) => (
          <div key={tab} hidden={tab !== props.tab}>{renderTab(tab)}</div>
        ))}
      </section>
    </main>
  );
}
