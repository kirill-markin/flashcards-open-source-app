package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isRemoteAccountDeletedError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class AnalyticsGuestIdentityLinkCoordinator(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore
) {
    private val sessionProvider: CloudSessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )

    /**
     * Deliberately not [operationCoordinator]: the link awaits a request context of its own, and
     * holding the cloud operation lock across that would make a user action wait for analytics.
     */
    private val analyticsGuestIdentityLinkMutex = Mutex()

    suspend fun linkAnalyticsGuestIdentityToSignedInAccount() {
        analyticsGuestIdentityLinkMutex.withLock {
            val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
            if (cloudSettings.cloudState != CloudAccountState.LINKED) {
                return@withLock
            }
            if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
                return@withLock
            }
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val guestSession: StoredGuestAiSession = guestSessionStore.loadAnySession(
                configuration = configuration
            )?.takeIf { session -> session.isAnalyticsOnly } ?: return@withLock
            val credentials: StoredCloudCredentials = analyticsGuestIdentityLinkCredentialsOrNull(
                configuration = configuration
            ) ?: return@withLock

            try {
                // Loads a request context first, which is what writes the account's identity row.
                // The link has no way to sequence that for itself and earns
                // `409 GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED` without it.
                val accountSnapshot: CloudAccountSnapshot = sessionProvider.fetchCloudAccount(
                    credentials = credentials,
                    configuration = configuration
                )
                // The credential has to belong to the account this install is linked to.
                // `authenticatedSession()` tests the same thing and answers a mismatch with a
                // destructive reset; here it is only a reason not to link, because
                // `analytics.identity_links` is first-link-wins and this guest's whole tail would
                // be attributed to the wrong account with no repair path.
                if (isSignedInAccountStillLinkedIdentity(accountSnapshot = accountSnapshot).not()) {
                    return@withLock
                }
                remoteService.linkGuestIdentity(
                    apiBaseUrl = configuration.apiBaseUrl,
                    bearerToken = credentials.idToken,
                    guestToken = guestSession.guestToken
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // Terminal, and deliberately silent here. Sync owns deleted-account handling and
                // does it through `disconnectDeletedCloudIdentityPreservingLocalState`, which keeps
                // local data; nothing about analytics may pre-empt that with a reset of its own.
                if (isRemoteAccountDeletedError(error = error)) {
                    return@withLock
                }
                if (error !is CloudRemoteException) {
                    throw error
                }
                if (isGuestIdentityUpgradeRequiredError(error = error)) {
                    retireAnalyticsOnlyGuestForUpgradePath(guestSession = guestSession)
                    return@withLock
                }
                if (isGuestIdentityOwnedByOtherAccountError(error = error).not()) {
                    throw error
                }
            }
            if (storedAnalyticsGuestStillMatchingOrNull(guestSession = guestSession) == null) {
                return@withLock
            }
            // Not the two keys this session happens to sit under: any other stored session would
            // survive and later be presented as an analytics credential or sent here again.
            guestSessionStore.clearStoredSessions()
        }
    }

    /**
     * The stored analytics-only guest re-read after the request, or null once it is no longer what
     * this install holds — the precondition for every store write this link makes afterwards.
     *
     * The capture above happens before a request context and the link itself, and
     * [analyticsGuestIdentityLinkMutex] deliberately does not hold the cloud operation lock across
     * them, so a logout and a fresh guest cloud session can both land in between. Without this
     * re-read [GuestAiSessionStore.clearStoredSessions] would delete that live cloud guest — leaving
     * `GUEST` with nothing stored, which reconciliation answers with the `GUEST_SESSION_MISSING`
     * credential-recovery gate — and [retireAnalyticsOnlyGuestForUpgradePath] would re-persist the
     * departed person's guest, which `CloudGuestSessionCoordinator`'s `loadAnySession` fallback
     * would later adopt as the next user's cloud guest.
     *
     * `LINKED` is re-read too: a boundary crossed since the capture leaves this install signed out,
     * and nothing about that install's guest is this account's business any more.
     */
    private fun storedAnalyticsGuestStillMatchingOrNull(
        guestSession: StoredGuestAiSession
    ): StoredGuestAiSession? {
        if (preferencesStore.currentCloudSettings().cloudState != CloudAccountState.LINKED) {
            return null
        }
        // Re-read as well, so a configuration change since the capture cannot make this lookup drop
        // sessions that are valid for the configuration in force now.
        val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
        val storedSession: StoredGuestAiSession = guestSessionStore.loadAnySession(
            configuration = configuration
        ) ?: return null
        if (storedSession.isAnalyticsOnly.not() || storedSession.guestToken != guestSession.guestToken) {
            return null
        }

        return storedSession
    }

    /**
     * Re-read rather than taken from the settings this call started with: a sign-in to another
     * account can land while the request context is in flight, and its guest belongs to that account
     * rather than this one.
     */
    private fun isSignedInAccountStillLinkedIdentity(accountSnapshot: CloudAccountSnapshot): Boolean {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            return false
        }

        val linkedUserId: String = cloudSettings.linkedUserId?.trim()?.ifEmpty { null } ?: return true
        return linkedUserId == accountSnapshot.userId
    }

    /**
     * The stored credential for the signed-in account, refreshed in memory only when it has expired.
     *
     * Deliberately **not** [CloudSessionProvider.authenticatedSession]. That helper turns a
     * `410 ACCOUNT_DELETED`, and a `linkedUserId` that does not match the fetched account, into
     * `resetLocalStateForCloudIdentityChange()` — which runs `database.clearAllTables()`. This path
     * is the only unattended caller in the app: it runs on every app start and after every sign-in,
     * with no user action behind it and no way back, so it must never reach a destructive reset.
     * A deleted account is sync's business, and sync answers it by preserving local data.
     *
     * Nothing is persisted here either. This path holds no cloud operation lock, so a refreshed
     * credential written back — or the account preferences [CloudSessionProvider.authenticatedSession]
     * also saves — could land after a concurrent logout had already cleared them, leaving
     * `DISCONNECTED` with an orphan credential. The refreshed token lives for this request only.
     */
    private suspend fun analyticsGuestIdentityLinkCredentialsOrNull(
        configuration: CloudServiceConfiguration
    ): StoredCloudCredentials? {
        val storedCredentials: StoredCloudCredentials = preferencesStore.loadCredentials() ?: return null
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            ).not()
        ) {
            return storedCredentials
        }

        return remoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    /**
     * `409 GUEST_IDENTITY_LINK_UPGRADE_REQUIRED` says the guest owns data only
     * `/guest-auth/upgrade/complete` can transfer, so the stored marker was wrong and is corrected
     * to match the server. The token is kept — dropping it would lose that data's owner.
     *
     * Correcting the marker is what stops this link from being attempted again, and that is the
     * whole of what this achieves: retrying unchanged can never succeed, and every attempt costs a
     * request context on top of the request, on every app start and every sign-in, forever.
     *
     * It does **not** route a later sign-in through the upgrade flow, and cannot: the only routes to
     * another sign-in on this install are logout and account deletion, and both clear every stored
     * session. That guest's cloud data stays with the guest account on the server.
     *
     * A conditional update rather than a write: it corrects a marker on a session that is still
     * stored, and must never re-create one deleted since the capture. See
     * [storedAnalyticsGuestStillMatchingOrNull] for what that would cost.
     */
    private fun retireAnalyticsOnlyGuestForUpgradePath(guestSession: StoredGuestAiSession) {
        val storedSession: StoredGuestAiSession = storedAnalyticsGuestStillMatchingOrNull(
            guestSession = guestSession
        ) ?: return
        guestSessionStore.saveSession(
            localWorkspaceId = storedSession.workspaceId,
            session = storedSession.copy(isAnalyticsOnly = false)
        )
    }

    private fun isGuestIdentityOwnedByOtherAccountError(error: CloudRemoteException): Boolean {
        return error.statusCode == 409 && error.errorCode == "GUEST_IDENTITY_LINK_OTHER_ACCOUNT"
    }

    private fun isGuestIdentityUpgradeRequiredError(error: CloudRemoteException): Boolean {
        return error.statusCode == 409 && error.errorCode == "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED"
    }
}
