package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradePreparation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEmailSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.drainGuestWorkspaceBeforeUpgrade
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.resumePendingGuestUpgradeRecoveryIfNeeded
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.resolvePreferredPostAuthWorkspaceId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class CloudSignInCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val sessionProvider: CloudSessionProvider,
    private val appVersion: String
) {
    suspend fun sendCode(email: String): CloudSendCodeResult {
        val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
        return remoteService.sendCode(
            email = email,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return operationCoordinator.runExclusive {
            if (preferencesStore.loadCloudCredentialRecoveryState() == null) {
                resumePendingGuestUpgradeIfNeeded()
            }
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            buildCloudWorkspaceLinkContext(
                credentials = credentials,
                configuration = configuration
            )
        }
    }

    suspend fun prepareSocialSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return operationCoordinator.runExclusive {
            prepareVerifiedSignIn(credentials = credentials)
        }
    }

    /**
     * [onVerified] runs the moment the remote call returns credentials: before the link context is
     * built, and not at all on the short circuit below, which returns blocked credentials without
     * verifying anything. A caller that reports the sign-in therefore never claims one where
     * nothing was verified, and never loses one whose workspace context failed to build afterwards.
     */
    suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        onVerified: () -> Unit
    ): CloudWorkspaceLinkContext = verifyCodeSession(challenge, code, {}) { onVerified() }

    suspend fun verifyCodeSession(
        challenge: CloudOtpChallenge,
        code: String,
        onVerificationStarted: () -> Unit,
        onVerified: suspend (CloudEmailSession) -> Unit
    ): CloudWorkspaceLinkContext {
        return operationCoordinator.runExclusive {
            val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
            if (recoveryState?.reason == CloudCredentialRecoveryReason.INVALID_STORED_STATE) {
                requirePendingGuestUpgradeStateIsDecodable()
                return@runExclusive invalidStoredRecoveryLinkContext(
                    credentials = blockedPostAuthRecoveryCredentials()
                )
            }
            if (recoveryState == null) {
                resumePendingGuestUpgradeIfNeeded()
            }
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            onVerificationStarted()
            val session: CloudEmailSession = remoteService.verifyCodeSession(
                challenge = challenge,
                code = code,
                authBaseUrl = configuration.authBaseUrl
            )
            onVerified(session)
            buildCloudWorkspaceLinkContext(
                credentials = session.credentials,
                configuration = configuration
            )
        }
    }

    private suspend fun buildCloudWorkspaceLinkContext(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ): CloudWorkspaceLinkContext {
        val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
        if (recoveryState != null) {
            requirePendingGuestUpgradeStateIsDecodable()
            return buildCloudWorkspaceRecoveryLinkContext(
                credentials = credentials,
                configuration = configuration,
                recoveryState = recoveryState
            )
        }

        // Every stored guest drives the upgrade flow except one that exists solely to authenticate
        // analytics: that one is claimed after sign-in through `/guest-auth/identity/link`, and
        // sending its token to `upgrade/prepare` here would route an install that has never enabled
        // cloud sync into the upgrade flow.
        //
        // The stored marker decides it, never `cloudState`. `finishGuestCloudLink` persists the
        // session before `markGuestCloudState`, and that write returns early under
        // `LINKED`/`LINKING_READY`, so a guest that owns a real cloud workspace can sit under a
        // non-`GUEST` state; skipping its upgrade would let `applyLinkedWorkspace` replace the local
        // shell and leave the link route answering `409 GUEST_IDENTITY_LINK_UPGRADE_REQUIRED`
        // forever.
        val guestSession: StoredGuestAiSession? = loadActiveGuestSessionOrNull(
            preferencesStore = preferencesStore,
            guestSessionStore = guestSessionStore,
            configuration = configuration
        )?.takeIf { session -> session.isAnalyticsOnly.not() }
        val localSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val guestUpgradePreparation: CloudGuestUpgradePreparation? = if (guestSession == null) {
            null
        } else if ((localSettings.activeWorkspaceId ?: localSettings.linkedWorkspaceId) == guestSession.workspaceId &&
            (localSettings.linkedUserId == null || localSettings.linkedUserId == guestSession.userId)) {
            preferencesStore.runWithLocalOutboxWritesBlocked(
                reason = "Guest sign-in is preparing. Wait for account linking before changing cards."
            ) {
                markGuestUpgradePreparationState()
                drainGuestWorkspaceBeforeUpgrade(
                    preferencesStore = preferencesStore,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore,
                    appVersion = appVersion,
                    configuration = configuration,
                    guestSession = guestSession
                )
                remoteService.prepareGuestUpgrade(
                    apiBaseUrl = configuration.apiBaseUrl,
                    bearerToken = credentials.idToken,
                    guestToken = guestSession.guestToken
                )
            }
        } else {
            val preparation = remoteService.prepareGuestUpgrade(
                apiBaseUrl = configuration.apiBaseUrl,
                bearerToken = credentials.idToken,
                guestToken = guestSession.guestToken
            )
            markGuestUpgradePreparationState()
            // The server hint covers the remote guest, not a different local workspace.
            preparation.copy(demoOnlyDestinationWorkspaceId = null)
        }
        val accountSnapshot: CloudAccountSnapshot = sessionProvider.fetchCloudAccount(
            credentials = credentials,
            configuration = configuration
        )
        val currentSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val retainedWorkspaceId: String? = currentSettings.activeWorkspaceId?.takeIf { workspaceId ->
            currentSettings.cloudState == CloudAccountState.LINKED &&
                currentSettings.linkedUserId == accountSnapshot.userId &&
                currentSettings.linkedWorkspaceId == workspaceId &&
                accountSnapshot.workspaces.any { workspace -> workspace.workspaceId == workspaceId }
        }
        return CloudWorkspaceLinkContext(
            userId = accountSnapshot.userId,
            email = accountSnapshot.email,
            credentials = credentials,
            workspaces = accountSnapshot.workspaces,
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            guestUpgradeMode = guestUpgradePreparation?.mode,
            demoOnlyDestinationWorkspaceId = guestUpgradePreparation?.demoOnlyDestinationWorkspaceId,
            preferredWorkspaceId = retainedWorkspaceId
                ?: resolvePreferredPostAuthWorkspaceId(workspaces = accountSnapshot.workspaces.filter(CloudWorkspaceSummary::isVisible))
        )
    }

    private suspend fun buildCloudWorkspaceRecoveryLinkContext(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        recoveryState: CloudCredentialRecoveryState
    ): CloudWorkspaceLinkContext {
        if (recoveryState.reason == CloudCredentialRecoveryReason.INVALID_STORED_STATE) {
            return invalidStoredRecoveryLinkContext(credentials = credentials)
        }

        val accountSnapshot: CloudAccountSnapshot = sessionProvider.fetchCloudAccount(
            credentials = credentials,
            configuration = configuration
        )
        return when (recoveryState.reason) {
            CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING -> {
                val route: CloudWorkspacePostAuthRoute = if (recoveryState.previousCloudState == CloudAccountState.GUEST) {
                    CloudWorkspacePostAuthRoute.PENDING_GUEST_UPGRADE_RECOVERY
                } else {
                    CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE
                }
                CloudWorkspaceLinkContext(
                    userId = accountSnapshot.userId,
                    email = accountSnapshot.email,
                    credentials = credentials,
                    workspaces = accountSnapshot.workspaces,
                    postAuthRoute = route,
                    guestUpgradeMode = null,
                    preferredWorkspaceId = resolveLinkedCredentialRecoveryPreferredWorkspaceIdOrNull(
                        recoveryState = recoveryState,
                        configuration = configuration,
                        accountSnapshot = accountSnapshot
                    )
                )
            }

            CloudCredentialRecoveryReason.GUEST_SESSION_MISSING -> CloudWorkspaceLinkContext(
                userId = accountSnapshot.userId,
                email = accountSnapshot.email,
                credentials = credentials,
                workspaces = accountSnapshot.workspaces,
                postAuthRoute = CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY,
                guestUpgradeMode = null,
                preferredWorkspaceId = resolvePreferredPostAuthWorkspaceId(workspaces = accountSnapshot.workspaces.filter(CloudWorkspaceSummary::isVisible))
            )

            CloudCredentialRecoveryReason.INVALID_STORED_STATE -> error(
                "Invalid recovery state must be handled before fetching a cloud account."
            )
        }
    }

    private suspend fun requirePendingGuestUpgradeStateIsDecodable() {
        withContext(Dispatchers.IO) {
            preferencesStore.loadPendingGuestUpgrade()
        }
    }

    private suspend fun resumePendingGuestUpgradeIfNeeded(): CloudWorkspaceSummary? {
        return resumePendingGuestUpgradeRecoveryIfNeeded(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            guestSessionStore = guestSessionStore,
            appVersion = appVersion,
            onGuestCompletionStarted = {},
            onGuestCompletionFinished = {}
        )
    }

    private suspend fun markGuestUpgradePreparationState() {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = cloudSettings.activeWorkspaceId
        )
    }
}
