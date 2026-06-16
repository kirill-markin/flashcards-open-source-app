import { useState, type ReactElement } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  FriendInviteErrorPanel,
  FriendInviteInactivePanel,
  FriendInviteLoadingPanel,
  FriendInviteReadyPanel,
  FriendInviteSignedOutPanel,
  FriendInviteSuccessPanel,
} from "../../../screens/invite/FriendInviteScreen";
import {
  buildFriendInvitePreviewRoute,
  friendInvitePreviewIndexRoute,
  reviewRoute,
} from "../../../routes";
import type { FriendInvitationAcceptResponse } from "../../../types";

const docsPath = "docs/web-invite-previews.md";
const previewStates = [
  "loading",
  "inactive",
  "error",
  "signed-out",
  "ready",
  "success",
  "already-friends",
] as const;

type FriendInvitePreviewState = (typeof previewStates)[number];

type FriendInvitePreviewChromeProps = Readonly<{
  state: FriendInvitePreviewState;
  children: ReactElement;
}>;

const acceptedPreviewResponse: FriendInvitationAcceptResponse = {
  status: "accepted",
};

const alreadyFriendsPreviewResponse: FriendInvitationAcceptResponse = {
  status: "already_friends",
  existingFriendDisplayName: "Alex",
};

function isFriendInvitePreviewEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_PREVIEWS === "true";
}

function isFriendInvitePreviewState(value: string): value is FriendInvitePreviewState {
  return previewStates.some((state) => state === value);
}

function readFriendInvitePreviewState(routeState: string | undefined): FriendInvitePreviewState | null {
  if (routeState === undefined || routeState === "") {
    return null;
  }

  if (isFriendInvitePreviewState(routeState)) {
    return routeState;
  }

  throw new Error(`Unknown friend invite preview state: ${routeState}`);
}

function handlePreviewAction(): void {
  // Preview buttons intentionally avoid backend calls.
}

function FriendInvitePreviewIndex(): ReactElement {
  return (
    <main className="dev-preview-page">
      <section className="content-card dev-preview-index-panel">
        <p className="dev-preview-eyebrow">Non-production invite previews</p>
        <h1 className="title">Friend invite preview pages</h1>
        <p className="subtitle">
          Open a specific invite state without accepting a real invite. Full manual testing instructions:
          {" "}
          <code>{docsPath}</code>.
        </p>
        <div className="dev-preview-link-list">
          {previewStates.map((state) => (
            <Link className="ghost-btn" key={state} to={buildFriendInvitePreviewRoute(state)}>
              {state}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function FriendInvitePreviewChrome({ state, children }: FriendInvitePreviewChromeProps): ReactElement {
  return (
    <div className="dev-preview-frame">
      <aside className="dev-preview-toolbar" aria-label="Friend invite preview instructions">
        <Link to={friendInvitePreviewIndexRoute}>Invite previews</Link>
        <span>
          State: <code>{state}</code>
        </span>
        <span>
          Manual testing docs: <code>{docsPath}</code>
        </span>
      </aside>
      <div className="dev-preview-screen" data-testid={`friend-invite-preview-${state}`}>
        {children}
      </div>
    </div>
  );
}

function renderFriendInvitePreviewState(
  state: FriendInvitePreviewState,
  friendDisplayName: string,
  onFriendDisplayNameChange: (value: string) => void,
): ReactElement {
  if (state === "loading") {
    return <FriendInviteLoadingPanel />;
  }

  if (state === "inactive") {
    return <FriendInviteInactivePanel errorMessage="" onRetry={handlePreviewAction} />;
  }

  if (state === "error") {
    return <FriendInviteErrorPanel errorMessage="Preview request failed." onRetry={handlePreviewAction} />;
  }

  if (state === "signed-out") {
    return <FriendInviteSignedOutPanel loginHref={buildFriendInvitePreviewRoute("ready")} />;
  }

  if (state === "ready") {
    return (
      <FriendInviteReadyPanel
        friendDisplayName={friendDisplayName}
        fieldErrorMessage=""
        errorMessage=""
        isSubmitting={false}
        canAccept
        onFriendDisplayNameChange={onFriendDisplayNameChange}
        onAccept={handlePreviewAction}
      />
    );
  }

  if (state === "success") {
    return <FriendInviteSuccessPanel acceptedResponse={acceptedPreviewResponse} />;
  }

  return <FriendInviteSuccessPanel acceptedResponse={alreadyFriendsPreviewResponse} />;
}

// Non-production preview routes are documented in docs/web-invite-previews.md.
export function FriendInvitePreviewScreen(): ReactElement {
  const { state } = useParams();
  const [friendDisplayName, setFriendDisplayName] = useState<string>("");

  if (!isFriendInvitePreviewEnabled()) {
    return <Navigate replace to={reviewRoute} />;
  }

  const previewState = readFriendInvitePreviewState(state);
  if (previewState === null) {
    return <FriendInvitePreviewIndex />;
  }

  return (
    <FriendInvitePreviewChrome state={previewState}>
      {renderFriendInvitePreviewState(previewState, friendDisplayName, setFriendDisplayName)}
    </FriendInvitePreviewChrome>
  );
}
