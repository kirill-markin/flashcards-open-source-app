package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
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
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.resumePendingGuestUpgradeRecoveryIfNeeded
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.resolvePreferredPostAuthWorkspaceId

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

    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
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
            val credentials: StoredCloudCredentials = remoteService.verifyCode(
                challenge = challenge,
                code = code,
                authBaseUrl = configuration.authBaseUrl
            )
            val linkContext: CloudWorkspaceLinkContext = buildCloudWorkspaceLinkContext(
                credentials = credentials,
                configuration = configuration
            )
            if (linkContext.guestUpgradeMode != null) {
                markGuestUpgradePreparationState()
            }
            linkContext
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

        val accountSnapshot: CloudAccountSnapshot = sessionProvider.fetchCloudAccount(
            credentials = credentials,
            configuration = configuration
        )
        val guestSession: StoredGuestAiSession? = loadActiveGuestSessionOrNull(
            preferencesStore = preferencesStore,
            guestSessionStore = guestSessionStore,
            configuration = configuration
        )
        val guestUpgradeMode: CloudGuestUpgradeMode? = if (guestSession == null) {
            null
        } else {
            remoteService.prepareGuestUpgrade(
                apiBaseUrl = configuration.apiBaseUrl,
                bearerToken = credentials.idToken,
                guestToken = guestSession.guestToken
            )
        }
        return CloudWorkspaceLinkContext(
            userId = accountSnapshot.userId,
            email = accountSnapshot.email,
            credentials = credentials,
            workspaces = accountSnapshot.workspaces,
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            guestUpgradeMode = guestUpgradeMode,
            preferredWorkspaceId = resolvePreferredPostAuthWorkspaceId(workspaces = accountSnapshot.workspaces)
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
                preferredWorkspaceId = resolvePreferredPostAuthWorkspaceId(workspaces = accountSnapshot.workspaces)
            )

            CloudCredentialRecoveryReason.INVALID_STORED_STATE -> error(
                "Invalid recovery state must be handled before fetching a cloud account."
            )
        }
    }

    private fun requirePendingGuestUpgradeStateIsDecodable() {
        preferencesStore.loadPendingGuestUpgrade()
    }

    private suspend fun resumePendingGuestUpgradeIfNeeded(): CloudWorkspaceSummary? {
        return resumePendingGuestUpgradeRecoveryIfNeeded(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            guestSessionStore = guestSessionStore,
            appVersion = appVersion
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
