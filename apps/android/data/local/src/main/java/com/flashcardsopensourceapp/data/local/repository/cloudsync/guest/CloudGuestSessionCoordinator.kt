package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.network.isRetryableHttpStatusCode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isRemoteAccountDeletedError
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.androidClientPlatform
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal data class CloudIdentityReconciliationResult(
    val cloudSettings: CloudSettings,
    val restoredGuestSession: StoredGuestAiSession?,
    val guestRestoreRequiresSync: Boolean,
    val didRunSync: Boolean
)

internal data class GuestCloudSessionRestoreResult(
    val session: StoredGuestAiSession,
    val shouldSync: Boolean
)

data class EnsuredGuestCloudSession(
    val workspaceId: String
)

private typealias GuestCloudLinkFinisher = suspend (StoredGuestAiSession, String?) -> Boolean
private typealias GuestBootstrapProbeLoader = suspend (StoredGuestAiSession, String) -> RemoteBootstrapPullResponse

class CloudGuestSessionCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val creationCoordinator: GuestCloudSessionCreationCoordinator,
    private val appVersion: String
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

    suspend fun reconcilePersistedCloudStateForStartup() {
        operationCoordinator.runExclusive {
            reconcilePersistedCloudStateLocked(
                finishGuestCloudLink = ::finishGuestCloudLinkForStartupNonCancellableLocked
            )
        }
    }

    suspend fun ensureGuestCloudSession(workspaceId: String): EnsuredGuestCloudSession {
        val restoredSession = restoreGuestCloudSessionIfNeeded(
            workspaceId = workspaceId,
            createSessionIfMissing = true
        )
        return EnsuredGuestCloudSession(
            workspaceId = restoredSession.session.workspaceId
        )
    }

    /**
     * Claims the analytics-only guest identity this install still holds for the account that signed
     * in, then drops the credential the server revoked with it.
     *
     * Only a session carrying `isAnalyticsOnly` is offered to this route, never `cloudState` as a
     * stand-in for it: a guest that owns cloud data converts through `/guest-auth/upgrade/complete`,
     * which writes the same identity link, and this route would revoke the session that flow still
     * needs. That guest can sit under any cloud state, so the marker is the only safe test.
     *
     * Every failure except `GUEST_IDENTITY_LINK_OTHER_ACCOUNT`,
     * `GUEST_IDENTITY_LINK_UPGRADE_REQUIRED` and `410 ACCOUNT_DELETED` keeps the guest token and
     * rethrows, because a guest session left live can later be bound to a different account:
     * dropping the token loses that guest's whole analytics tail, and skipping the retry can
     * attribute it to somebody else. The next sign-in or app start retries.
     *
     * The process-wide analytics opt-out lives in `:app` and is enforced by the only caller,
     * `AppGraph.requestAnalyticsGuestIdentityLink`, which never reaches this function while it is
     * set: the `analytics.identity_links` write this makes is append-only and first-link-wins, so an
     * opted-out process must stop before the identity is requested, not merely hold its events back.
     * A second caller has to carry that gate too.
     */
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
     * departed person's guest, which [loadGuestSessionForCurrentConfiguration]'s `loadAnySession`
     * fallback would later adopt as the next user's cloud guest.
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

    suspend fun deleteStoredGuestCloudSessionIfPresent() {
        operationCoordinator.runExclusive {
            deleteStoredGuestCloudSessionIfPresentLocked()
        }
    }

    internal suspend fun reconcilePersistedCloudState(): CloudIdentityReconciliationResult {
        return operationCoordinator.runExclusive {
            reconcilePersistedCloudStateLocked()
        }
    }

    internal suspend fun restoreGuestCloudSessionIfNeeded(
        workspaceId: String?,
        createSessionIfMissing: Boolean
    ): GuestCloudSessionRestoreResult {
        return operationCoordinator.runExclusive {
            restoreGuestCloudSessionIfNeededLocked(
                workspaceId = workspaceId,
                createSessionIfMissing = createSessionIfMissing
            )
        }
    }

    internal suspend fun reconcilePersistedCloudStateLocked(): CloudIdentityReconciliationResult {
        return reconcilePersistedCloudStateLocked(
            finishGuestCloudLink = ::finishGuestCloudLinkNonCancellableLocked
        )
    }

    private suspend fun reconcilePersistedCloudStateLocked(
        finishGuestCloudLink: GuestCloudLinkFinisher
    ): CloudIdentityReconciliationResult {
        val activeRecoveryState = preferencesStore.loadCloudCredentialRecoveryState()
        if (activeRecoveryState == null || activeRecoveryState.isPendingGuestUpgradeRecovery()) {
            val recoveredGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeRecoveryIfNeeded(
                database = database,
                preferencesStore = preferencesStore,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore,
                guestSessionStore = guestSessionStore,
                appVersion = appVersion
            )
            if (recoveredGuestUpgrade != null) {
                return CloudIdentityReconciliationResult(
                    cloudSettings = preferencesStore.currentCloudSettings(),
                    restoredGuestSession = null,
                    guestRestoreRequiresSync = false,
                    didRunSync = false
                )
            }
        }

        activeCredentialRecoveryReconciliationResultOrNull(recoveryState = activeRecoveryState)?.let { result ->
            return result
        }

        var currentCloudSettings = preferencesStore.currentCloudSettings()
        if (hasInvalidActiveWorkspaceId(cloudSettings = currentCloudSettings)) {
            normalizeActiveWorkspaceIdToLocalShell()
            currentCloudSettings = preferencesStore.currentCloudSettings()
        }

        if (currentCloudSettings.cloudState == CloudAccountState.LINKING_READY) {
            normalizeLegacyLinkingReadyStateLocked(cloudSettings = currentCloudSettings)
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = preferencesStore.loadCredentials()
        val storedGuestSession = guestSessionStore.loadAnySession(configuration = configuration)
        val reconciledCloudSettings = preferencesStore.currentCloudSettings()
        // A linked account holding a guest session is the analytics guest waiting for its identity
        // link, not an inconsistency: it is minted without cloud state and dropped once
        // `linkAnalyticsGuestIdentityToSignedInAccount` succeeds. Resetting here would sign the
        // person out for the duration of a retryable link failure.
        if (
            storedCredentials != null &&
            storedGuestSession != null &&
            reconciledCloudSettings.cloudState != CloudAccountState.LINKED
        ) {
            guestSessionStore.clearAllSessions()
            resetCoordinator.disconnectCloudIdentityPreservingLocalState()
            return CloudIdentityReconciliationResult(
                cloudSettings = preferencesStore.currentCloudSettings(),
                restoredGuestSession = null,
                guestRestoreRequiresSync = false,
                didRunSync = false
            )
        }

        return when (reconciledCloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                if (storedCredentials == null) {
                    markCloudCredentialRecoveryRequired(
                        reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                        cloudSettings = reconciledCloudSettings
                    )
                    resetCoordinator.disconnectCloudIdentityPreservingLocalState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    preferencesStore.clearCloudCredentialRecoveryState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = reconciledCloudSettings,
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.GUEST -> {
                if (storedGuestSession == null) {
                    markCloudCredentialRecoveryRequired(
                        reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
                        cloudSettings = reconciledCloudSettings
                    )
                    resetCoordinator.disconnectCloudIdentityPreservingLocalState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = null,
                        guestRestoreRequiresSync = false,
                        didRunSync = false
                    )
                } else {
                    val shouldSync = finishGuestCloudLink(storedGuestSession, storedGuestSession.workspaceId)
                    preferencesStore.clearCloudCredentialRecoveryState()
                    CloudIdentityReconciliationResult(
                        cloudSettings = preferencesStore.currentCloudSettings(),
                        restoredGuestSession = storedGuestSession,
                        guestRestoreRequiresSync = shouldSync,
                        didRunSync = false
                    )
                }
            }

            CloudAccountState.DISCONNECTED -> {
                CloudIdentityReconciliationResult(
                    cloudSettings = reconciledCloudSettings,
                    restoredGuestSession = null,
                    guestRestoreRequiresSync = false,
                    didRunSync = false
                )
            }

            CloudAccountState.LINKING_READY -> {
                error("Legacy linking-ready cloud state must be normalized before reconciliation.")
            }
        }
    }

    private suspend fun restoreGuestCloudSessionIfNeededLocked(
        workspaceId: String?,
        createSessionIfMissing: Boolean
    ): GuestCloudSessionRestoreResult {
        val reconciliation = reconcilePersistedCloudStateLocked()
        val activeRecoveryState = preferencesStore.loadCloudCredentialRecoveryState()
        if (activeRecoveryState != null) {
            throw CloudCredentialRecoveryRequiredException(recoveryState = activeRecoveryState)
        }

        if (reconciliation.cloudSettings.cloudState == CloudAccountState.GUEST) {
            val session = requireNotNull(reconciliation.restoredGuestSession) {
                "Guest cloud state is missing a stored guest session."
            }
            return GuestCloudSessionRestoreResult(
                session = session,
                shouldSync = reconciliation.guestRestoreRequiresSync
            )
        }

        // A signed-in account must never fall through to the guest restore: the analytics guest an
        // install now commonly holds while `LINKED` would be found below, and
        // `migrateLocalShellToLinkedWorkspace` would replace the account's local workspace with the
        // guest's. Reconciliation no longer repairs `LINKED` plus a stored guest session, which is
        // what used to make this unreachable incidentally, and every production caller — AI chat,
        // feedback and sync — resolves a bearer session before reaching here. `AppGraph
        // .ensureGuestCloudSession` is callable from anywhere, so the invariant is stated rather
        // than assumed.
        //
        // Stated as a bail rather than a `require`, because reaching it is not a programming error.
        // AI chat and feedback read `cloudState` in one `runExclusive` and re-enter the lock for
        // this call, so a sign-in completing between the two lands here through no fault of theirs
        // and must not crash a user-facing action. It fails the way the bearer path fails when it
        // cannot build a session; the retry reads `LINKED` and takes that path.
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.LINKED) {
            throw IllegalStateException(
                "Cloud account signed in while preparing a guest session. Try again."
            )
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val existingSession = loadGuestSessionForCurrentConfiguration(
            workspaceId = workspaceId,
            configurationApiBaseUrl = configuration.apiBaseUrl
        )
        val resolvedSession = if (existingSession != null) {
            existingSession
        } else {
            require(createSessionIfMissing) {
                "Guest AI session is unavailable."
            }
            // A missing stored session here means we already crossed a full
            // local identity reset boundary such as logout or account deletion,
            // which clears the pending creation idempotency key along with the
            // sessions. The recreated guest session is therefore a brand new
            // guest identity, not a continuation of any older guest account
            // that may have been linked previously.
            creationCoordinator.loadOrCreateGuestCloudSession(
                configuration = configuration,
                isAnalyticsOnly = false
            )
        }
        val shouldSync = finishGuestCloudLinkNonCancellableLocked(
            session = resolvedSession,
            workspaceId = workspaceId
        )
        preferencesStore.clearCloudCredentialRecoveryState()
        return GuestCloudSessionRestoreResult(
            // Matches what was just persisted: adopting the analytics mint's session makes it this
            // install's cloud guest, and the marker no longer applies to it.
            session = resolvedSession.copy(isAnalyticsOnly = false),
            shouldSync = shouldSync
        )
    }

    private fun activeCredentialRecoveryReconciliationResultOrNull(
        recoveryState: CloudCredentialRecoveryState?
    ): CloudIdentityReconciliationResult? {
        if (recoveryState == null) {
            return null
        }
        preferencesStore.loadPendingGuestUpgrade()
        return CloudIdentityReconciliationResult(
            cloudSettings = preferencesStore.currentCloudSettings(),
            restoredGuestSession = null,
            guestRestoreRequiresSync = false,
            didRunSync = false
        )
    }

    private fun CloudCredentialRecoveryState.isPendingGuestUpgradeRecovery(): Boolean {
        return reason == CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING &&
            previousCloudState == CloudAccountState.GUEST
    }

    private fun markCloudCredentialRecoveryRequired(
        reason: CloudCredentialRecoveryReason,
        cloudSettings: CloudSettings
    ) {
        val configuration = preferencesStore.currentServerConfiguration()
        preferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = reason,
                previousCloudState = cloudSettings.cloudState,
                installationId = cloudSettings.installationId,
                linkedUserId = cloudSettings.linkedUserId,
                linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                linkedEmail = cloudSettings.linkedEmail,
                configurationMode = configuration.mode,
                apiBaseUrl = configuration.apiBaseUrl,
                detectedAtMillis = System.currentTimeMillis()
            )
        )
    }

    private suspend fun deleteStoredGuestCloudSessionIfPresentLocked() {
        val configuration = preferencesStore.currentServerConfiguration()
        val storedGuestSession = guestSessionStore.loadAnySession(configuration = configuration)
            ?: return

        try {
            remoteService.deleteGuestSession(
                apiBaseUrl = storedGuestSession.apiBaseUrl,
                guestToken = storedGuestSession.guestToken
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isGuestSessionInvalidError(error = error).not()) {
                throw error
            }
        }

        clearStoredGuestCloudSessionLocalState(session = storedGuestSession)
    }

    private suspend fun finishGuestCloudLinkNonCancellableLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        return withContext(NonCancellable) {
            finishGuestCloudLinkIfNeededLocked(
                session = session,
                workspaceId = workspaceId,
                bootstrapProbeLoader = ::loadRequiredGuestBootstrapProbe
            )
        }
    }

    private suspend fun finishGuestCloudLinkForStartupNonCancellableLocked(
        session: StoredGuestAiSession,
        workspaceId: String?
    ): Boolean {
        return withContext(NonCancellable) {
            finishGuestCloudLinkIfNeededLocked(
                session = session,
                workspaceId = workspaceId,
                bootstrapProbeLoader = ::loadStartupGuestBootstrapProbe
            )
        }
    }

    private fun loadGuestSessionForCurrentConfiguration(
        workspaceId: String?,
        configurationApiBaseUrl: String
    ): StoredGuestAiSession? {
        val configuration = preferencesStore.currentServerConfiguration()
        require(configuration.apiBaseUrl == configurationApiBaseUrl) {
            "Guest session configuration mismatch. expected='${configuration.apiBaseUrl}' actual='$configurationApiBaseUrl'"
        }
        if (workspaceId.isNullOrBlank()) {
            return guestSessionStore.loadAnySession(configuration = configuration)
        }

        // The analytics mint stores its session unbound to a local workspace, so a workspace-scoped
        // miss still has to find it. Creating a second one instead would be a second permanent
        // guest identity, and `analytics.identity_links` is first-link-wins with no repair path.
        return guestSessionStore.loadSession(
            localWorkspaceId = workspaceId,
            configuration = configuration
        ) ?: guestSessionStore.loadAnySession(configuration = configuration)
    }

    /**
     * Takes a guest session over as this install's cloud guest: the local shell is migrated onto its
     * workspace and cloud state becomes `GUEST`.
     *
     * Everything it stores drops `isAnalyticsOnly`, including a session the analytics mint created:
     * from here on that guest owns cloud data, so it must convert through
     * `/guest-auth/upgrade/complete` and must never be offered to `/guest-auth/identity/link`, which
     * would revoke it. `markGuestCloudState` returns early under `LINKED`/`LINKING_READY`, so the
     * stored marker — not the resulting cloud state — is what carries this fact.
     */
    private suspend fun finishGuestCloudLinkIfNeededLocked(
        session: StoredGuestAiSession,
        workspaceId: String?,
        bootstrapProbeLoader: GuestBootstrapProbeLoader
    ): Boolean {
        val cloudOwnedSession: StoredGuestAiSession = session.copy(isAnalyticsOnly = false)
        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val currentWorkspace = loadCurrentWorkspaceForRestoreOrNull(workspaceId = workspaceId)
        val isAlreadyGuestLinked = currentCloudSettings.cloudState == CloudAccountState.GUEST &&
            currentWorkspace?.workspaceId == session.workspaceId &&
            currentCloudSettings.linkedUserId == session.userId &&
            currentCloudSettings.linkedWorkspaceId == session.workspaceId &&
            currentCloudSettings.activeWorkspaceId == session.workspaceId
        if (isAlreadyGuestLinked) {
            guestSessionStore.saveSession(
                localWorkspaceId = cloudOwnedSession.workspaceId,
                session = cloudOwnedSession
            )
            markGuestCloudState(session = cloudOwnedSession)
            return false
        }

        val bootstrapProbe: RemoteBootstrapPullResponse = bootstrapProbeLoader(
            session,
            currentCloudSettings.installationId
        )
        val workspaceSummary = guestWorkspaceSummary(
            currentWorkspaceId = currentWorkspace?.workspaceId,
            currentWorkspaceName = currentWorkspace?.name,
            currentWorkspaceCreatedAtMillis = currentWorkspace?.createdAtMillis,
            session = session
        )
        val resultingWorkspace = syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = workspaceSummary,
            remoteWorkspaceIsEmpty = bootstrapProbe.remoteIsEmpty
        )
        require(resultingWorkspace.workspaceId == session.workspaceId) {
            "Guest workspace restore produced an unexpected local workspace. " +
                "Expected='${session.workspaceId}' Actual='${resultingWorkspace.workspaceId}'."
        }
        if (currentWorkspace?.workspaceId != null && currentWorkspace.workspaceId != session.workspaceId) {
            guestSessionStore.clearSession(localWorkspaceId = currentWorkspace.workspaceId)
        }
        guestSessionStore.saveSession(
            localWorkspaceId = cloudOwnedSession.workspaceId,
            session = cloudOwnedSession
        )
        markGuestCloudState(session = cloudOwnedSession)
        return bootstrapProbe.remoteIsEmpty.not()
    }

    private fun isCloudAuthorizationError(error: Exception): Boolean {
        return error is CloudRemoteException &&
            (error.statusCode == 401 || error.statusCode == 403)
    }

    private fun isGuestIdentityOwnedByOtherAccountError(error: CloudRemoteException): Boolean {
        return error.statusCode == 409 && error.errorCode == "GUEST_IDENTITY_LINK_OTHER_ACCOUNT"
    }

    private fun isGuestIdentityUpgradeRequiredError(error: CloudRemoteException): Boolean {
        return error.statusCode == 409 && error.errorCode == "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED"
    }

    private fun isGuestSessionInvalidError(error: Exception): Boolean {
        return error is CloudRemoteException &&
            error.statusCode == 401 &&
            error.errorCode == "GUEST_AUTH_INVALID"
    }

    private suspend fun clearStoredGuestCloudSessionLocalState(session: StoredGuestAiSession) {
        // The session was found through `loadAnySession`, so the two keys it usually sits under are
        // not necessarily the only ones holding it or another guest; the server-side guest this
        // install had is gone, and nothing stored may outlive it as an analytics credential.
        guestSessionStore.clearStoredSessions()

        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val shouldDisconnectDeletedGuestState = currentCloudSettings.cloudState == CloudAccountState.GUEST &&
            (
                currentCloudSettings.linkedUserId == session.userId ||
                    currentCloudSettings.linkedWorkspaceId == session.workspaceId ||
                    currentCloudSettings.activeWorkspaceId == session.workspaceId
                )
        if (shouldDisconnectDeletedGuestState) {
            resetCoordinator.disconnectCloudIdentityPreservingLocalState()
        }
    }

    private suspend fun loadCurrentWorkspaceForRestoreOrNull(workspaceId: String?): WorkspaceEntity? {
        if (workspaceId.isNullOrBlank()) {
            return loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            )
        }

        val workspaces = database.workspaceDao().loadWorkspaces()
        if (workspaces.isEmpty()) {
            return null
        }
        return workspaces.firstOrNull { workspace ->
            workspace.workspaceId == workspaceId
        }
    }

    private suspend fun runGuestBootstrapPull(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return remoteService.bootstrapPull(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = "Guest ${session.guestToken}",
            workspaceId = session.workspaceId,
            body = org.json.JSONObject()
                .put("mode", "pull")
                .put("installationId", installationId)
                .put("platform", androidClientPlatform)
                .put("appVersion", appVersion)
                .put("cursor", org.json.JSONObject.NULL)
                .put("limit", 1)
                .put("includeMediaAssets", true)
        )
    }

    private suspend fun loadRequiredGuestBootstrapProbe(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return runGuestBootstrapPull(
            session = session,
            installationId = installationId
        )
    }

    private suspend fun loadStartupGuestBootstrapProbe(
        session: StoredGuestAiSession,
        installationId: String
    ): RemoteBootstrapPullResponse {
        return try {
            loadRequiredGuestBootstrapProbe(
                session = session,
                installationId = installationId
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isRetryableStartupCloudReconciliationFailure(error = error).not()) {
                throw error
            }
            markStartupCloudReconciliationFailure(error = error)
            throw IllegalStateException(
                startupCloudReconciliationFailureMessage(error = error),
                error
            )
        }
    }

    private fun guestWorkspaceSummary(
        currentWorkspaceId: String?,
        currentWorkspaceName: String?,
        currentWorkspaceCreatedAtMillis: Long?,
        session: StoredGuestAiSession
    ): CloudWorkspaceSummary {
        val workspaceName = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceName ?: "Personal"
        } else {
            currentWorkspaceName ?: "Personal"
        }
        val createdAtMillis = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        } else {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        }
        return CloudWorkspaceSummary(
            workspaceId = session.workspaceId,
            name = workspaceName,
            createdAtMillis = createdAtMillis,
            isSelected = true
        )
    }

    private suspend fun markGuestCloudState(session: StoredGuestAiSession) {
        val currentCloudState = preferencesStore.currentCloudSettings().cloudState
        if (
            currentCloudState == CloudAccountState.LINKED ||
            currentCloudState == CloudAccountState.LINKING_READY
        ) {
            return
        }

        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = session.userId,
            linkedWorkspaceId = session.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = session.workspaceId
        )
    }

    private suspend fun hasInvalidActiveWorkspaceId(cloudSettings: CloudSettings): Boolean {
        val activeWorkspaceId = cloudSettings.activeWorkspaceId ?: return false
        return database.workspaceDao().loadWorkspaceById(activeWorkspaceId) == null
    }

    private suspend fun normalizeActiveWorkspaceIdToLocalShell() {
        val fallbackWorkspaceId = database.workspaceDao().loadAnyWorkspace()?.workspaceId
        val resolvedWorkspaceId = if (fallbackWorkspaceId != null) {
            fallbackWorkspaceId
        } else {
            ensureLocalWorkspaceShell(
                database = database,
                currentTimeMillis = System.currentTimeMillis()
            ).workspaceId
        }
        preferencesStore.updateActiveWorkspaceId(activeWorkspaceId = resolvedWorkspaceId)
    }

    private suspend fun normalizeLegacyLinkingReadyStateLocked(cloudSettings: CloudSettings) {
        preferencesStore.clearCredentials()
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = cloudSettings.activeWorkspaceId
        )
    }

    private fun isRetryableStartupCloudReconciliationFailure(error: Exception): Boolean {
        val cloudRemoteError: CloudRemoteException? = error as? CloudRemoteException
            ?: findCloudRemoteCause(error = error)
        if (cloudRemoteError != null) {
            return isRetryableHttpStatusCode(statusCode = cloudRemoteError.statusCode)
        }
        val ioError: IOException? = error as? IOException ?: findIoCause(error = error)
        return ioError != null && isLikelyTransientNetworkIoException(error = ioError)
    }

    private fun findCloudRemoteCause(error: Throwable): CloudRemoteException? {
        var currentCause: Throwable? = error.cause
        while (currentCause != null) {
            if (currentCause is CloudRemoteException) {
                return currentCause
            }
            currentCause = currentCause.cause
        }
        return null
    }

    private fun findIoCause(error: Throwable): IOException? {
        var currentCause: Throwable? = error.cause
        while (currentCause != null) {
            if (currentCause is IOException) {
                return currentCause
            }
            currentCause = currentCause.cause
        }
        return null
    }

    private suspend fun markStartupCloudReconciliationFailure(error: Exception) {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val workspaceId: String = localWorkspaceIdForSyncFailure(cloudSettings = cloudSettings) ?: return
        syncLocalStore.markSyncFailure(
            workspaceId = workspaceId,
            errorMessage = startupCloudReconciliationFailureMessage(error = error)
        )
    }

    private suspend fun localWorkspaceIdForSyncFailure(cloudSettings: CloudSettings): String? {
        val candidateWorkspaceIds: List<String> = listOfNotNull(
            cloudSettings.activeWorkspaceId,
            cloudSettings.linkedWorkspaceId
        ).distinct()
        return candidateWorkspaceIds.firstOrNull { workspaceId ->
            database.workspaceDao().loadWorkspaceById(workspaceId = workspaceId) != null
        }
    }

    private fun startupCloudReconciliationFailureMessage(error: Exception): String {
        val retryableCause: Throwable = findIoCause(error = error)
            ?: findCloudRemoteCause(error = error)
            ?: error
        val causeMessage: String = retryableCause.message?.trim()?.takeIf { message -> message.isNotEmpty() }
            ?: retryableCause::class.java.simpleName
        return "Startup cloud reconciliation could not finish because cloud sync is temporarily unavailable. " +
            "Check your connection and reopen the app. Cause=$causeMessage"
    }
}
