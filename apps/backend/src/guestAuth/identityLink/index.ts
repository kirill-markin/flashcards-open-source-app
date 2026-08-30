import { randomUUID } from "node:crypto";
import { assertSubjectIsNotDeletedInExecutor } from "../../auth/deletedSubjects";
import {
  hasCognitoIdentityMappingForUserInExecutor,
  loadCognitoIdentityMappingInExecutor,
  lockCognitoIdentityLifecycleInExecutor,
} from "../../auth/userIdentities";
import type { DatabaseExecutor } from "../../database";
import { insertProductAnalyticsIdentityLinkInExecutor } from "../../productAnalytics/writer";
import { HttpError } from "../../shared/errors";
import {
  guestOwnsUpgradeTransferableDataInExecutor,
  loadGuestSessionRecordWithUserSettingsLockInExecutor,
  loadGuestWorkspaceIdInExecutor,
  revokeGuestSessionInExecutor,
} from "../store/index";

function createGuestOwnsTransferableDataError(): HttpError {
  return new HttpError(
    409,
    "This guest session owns data that the upgrade transfers and cannot be linked for analytics only. Convert it through /guest-auth/upgrade/complete instead.",
    "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
  );
}

function createGuestIdentityLinkAccountRequiredError(): HttpError {
  return new HttpError(
    409,
    "Finish signing in to this account before linking a guest identity. Keep the guest token and retry.",
    "GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED",
  );
}

function createGuestIdentityLinkOtherAccountError(): HttpError {
  return new HttpError(
    409,
    "This guest session already belongs to a different account and cannot be linked to the signed-in one.",
    "GUEST_IDENTITY_LINK_OTHER_ACCOUNT",
  );
}

/**
 * Claims the analytics history of one guest identity for the account that is now signed in.
 *
 * This is the counterpart of `recordGuestUpgradeCompletedAnalytics` for the guests that never reach
 * `/guest-auth/upgrade/complete`: a signed-out browser, and a mobile install whose guest credential
 * exists only to authenticate analytics. Nothing is merged, created, selected or deleted here. The
 * whole effect is one identity link plus the revoke that retires the credential the account has just
 * replaced. That revoke is terminal for the upgrade flow, because both upgrade routes refuse a
 * revoked token, so `docs/auth-service.md` requires callers never to send a token here that may
 * still need `/guest-auth/upgrade/prepare` or `/guest-auth/upgrade/complete`.
 *
 * An unknown or already-revoked token is a successful no-op so a client retry after a lost response
 * is safe.
 *
 * The account user id is resolved here, from `auth.user_identities` under the Cognito identity
 * lifecycle lock, rather than taken from the authenticated request. Authentication reports
 * `mapping?.userId ?? identity.userId`, so for a subject with no mapping row yet it reports the raw
 * Cognito subject, and `prepareGuestUpgradeInExecutor` can still bind that subject to a guest user
 * id instead. A link keyed on the wrong id is not recoverable: `analytics.identity_links` attributes
 * an anonymous tail to the first link written for an `anonymous_id`, so a later correct link cannot
 * displace it. `completeGuestUpgradeInExecutor` resolves the target the same way and refuses when the
 * mapping is absent; `prepareGuestUpgradeInExecutor` does not refuse but binds the mapping itself, in
 * both of its absent-mapping branches, which is precisely what makes `complete`'s refusal safe — it
 * always runs second. This route has no such predecessor, so its one real precondition is that some
 * earlier request loaded a request context for this subject: `loadAuthenticatedRequestContext` runs
 * `ensureCognitoUserProfileInExecutor`, which binds `auth.user_identities` on every bearer or session
 * request. Until that has happened this route refuses with `GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED`,
 * which is retryable rather than terminal: nothing in it is wrong with the guest token, and a client
 * that drops the token on it loses that guest's whole tail. `docs/auth-service.md` states the
 * ordering obligation and the retry rule for the clients that call this route.
 *
 * The deleted-subject gate below is the same one both guest-upgrade paths take, and it is not
 * optional here. A deleted account's client keeps a valid id token until it expires, and account
 * deletion sweeps `analytics.identity_links` exactly once and never runs again, so a link written
 * inside that window would be permanent and would silently break the deletion guarantee. Taking the
 * Cognito identity lifecycle lock first is what closes the window rather than narrowing it: account
 * deletion holds that same lock across its sweep and its tombstone write, so this transaction either
 * runs before the sweep and has its link swept, or waits and sees the tombstone. That lock is also
 * the one this repository requires ahead of user-settings, guest-session and workspace lifecycle
 * locks, which is why it is taken before the guest session is loaded.
 *
 * The link and the revoke are both written on this transaction and therefore reach the same commit:
 * neither can land without the other. That is what makes the pair safe rather than the order of the
 * two statements, and it is not a refinement. A link without its revoke leaves a guest session live
 * and unbound, which a later `/guest-auth/upgrade/prepare` can bind to a *different* account, and
 * `first_guest_upgrade_link` in 0115 is first-link-wins, so the orphan would then attribute that
 * account's whole pre-account tail to this one permanently, with no repair path. A client retry
 * closed that window only for the callers that have one; `apps/auth`'s sign-in producer drops the
 * only copy of the guest token on every outcome and has nothing to retry with.
 *
 * `docs/auth-service.md` still asks a client to retry a 5xx from this route with the guest token
 * kept, because the guest's tail is still unclaimed — not because a failure left something behind to
 * repair. A commit whose outcome is unknown is the one shape a repeat may find already done.
 */
export async function linkGuestAnalyticsIdentityInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
): Promise<void> {
  await lockCognitoIdentityLifecycleInExecutor(executor, cognitoSubject);
  await assertSubjectIsNotDeletedInExecutor(executor, cognitoSubject);

  const guestSession = await loadGuestSessionRecordWithUserSettingsLockInExecutor(executor, guestToken);
  if (guestSession === null || guestSession.revokedAt !== null) {
    return;
  }

  const accountMapping = await loadCognitoIdentityMappingInExecutor(executor, cognitoSubject);
  if (accountMapping === null) {
    throw createGuestIdentityLinkAccountRequiredError();
  }

  // The guest user id is already this account, so its events resolve to the account without a link
  // and writing one would map the identity to itself. This mirrors the bound-completion branch of
  // recordGuestUpgradeCompletedAnalytics, and it is reached routinely: the bound branch of
  // /guest-auth/upgrade/complete deliberately leaves the session it converts live, so a mobile
  // install commonly holds a guest credential whose user is this very account.
  //
  // It is answered before the content probe below, because that probe would otherwise read the
  // account's own workspace and refuse this state with GUEST_IDENTITY_LINK_UPGRADE_REQUIRED,
  // telling the client to convert through a flow it has already completed. The probe's own
  // justification does not hold here either: these rows sit behind a credential the account still
  // reaches.
  //
  // The session is deliberately not revoked. This credential is the account's own, and revoking it
  // would route a later /guest-auth/upgrade/complete retry into
  // resolveRevokedGuestUpgradeReplayInExecutor, which finds no auth.guest_upgrade_history row for a
  // bound completion and answers 401 GUEST_AUTH_INVALID instead of replaying it.
  if (guestSession.userId === accountMapping.userId) {
    return;
  }

  // Past this point the guest user id is not this account's, so a guest user that is nevertheless
  // bound to a Cognito subject belongs to some *other* real account, and this route must not treat
  // it as an ordinary guest. That is the same invariant the two sibling paths enforce with this same
  // probe: rotateGuestSessionForCreationIdempotencyKeyInExecutor disarms such a row rather than hand
  // its credential back, and deleteGuestSessionInExecutor refuses to delete it.
  //
  // Linking it would write anonymous_id = the other account's own user id. first_guest_upgrade_link
  // outranks product_events.user_id in analytics.product_events_resolved and identity_links is
  // append-only and first-link-wins, so that account's entire pre-account history would resolve to
  // this one permanently, with no repair path; the revoke below would then retire that account's
  // live credential, which is exactly what the same-account branch above explains must not happen.
  // The content probe cannot stand in for this check: a bound-from-empty or analytics-only guest
  // owns nothing, so it sails straight past.
  //
  // This is deliberately placed after the same-account early return above, never before it: that
  // state is the routine post-bound-upgrade case a mobile install reaches on every call, and
  // refusing it here would turn a documented no-op into a failure.
  if (await hasCognitoIdentityMappingForUserInExecutor(executor, guestSession.userId)) {
    throw createGuestIdentityLinkOtherAccountError();
  }

  // A guest that owns data the upgrade would transfer must convert through the upgrade flow, which
  // moves that data onto the account. Revoking its session here would leave the rows behind a user
  // no credential can reach any more, and no path recovers them. Web guests and analytics-only
  // mobile guests own nothing, so this costs nothing on the paths that call this route.
  const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestSession.userId);
  if (await guestOwnsUpgradeTransferableDataInExecutor(executor, guestSession.userId, guestWorkspaceId)) {
    throw createGuestOwnsTransferableDataError();
  }

  // The client's own anonymous_id is not known here, so the link is keyed on the guest user id
  // that the guest's events carried as subject_user_id, which is the shape
  // analytics.product_events_resolved reads in its server namespace.
  //
  // Written on this transaction, beside the revoke below, rather than on the analytics writer's own
  // pool. Both pools resolve the same database URL and so the same role, and 0114 and 0115 grant
  // that role the INSERT, the source-scoped UPDATE and the row-level policies this statement needs,
  // so nothing about the write itself changes here.
  // recordGuestUpgradeCompletedAnalytics keeps the opposite arrangement, deliberately and for the
  // opposite reason: it runs after an upgrade that has already committed and is best effort, so a
  // link written inside that transaction could outlive an upgrade that then rolled back. Here the
  // link is the entire point of the request and the revoke only retires the credential it replaces,
  // so the two belong in one commit.
  await insertProductAnalyticsIdentityLinkInExecutor(executor, {
    linkId: randomUUID(),
    anonymousId: guestSession.userId,
    userId: accountMapping.userId,
    source: "server_derived",
  });

  await revokeGuestSessionInExecutor(executor, guestSession.userId, guestSession.sessionId);
}
