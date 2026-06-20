package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireActiveCloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireCloudLinkMatchesCredentialRecoveryBeforeSideEffects
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireGuestLocalRecoveryAllowsCreateNewCompletion
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requirePostAuthRouteAllowsCloudLinkCompletion
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireWorkspaceSelectionMatchesCredentialRecoveryBeforeSideEffects
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.resumePendingGuestUpgradeRecoveryIfNeeded
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isCloudIdentityConflictError
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudWorkspaceForkRecoveryMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runCloudSyncCore
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.syncBlockedExceptionFor
import kotlinx.coroutines.CancellationException

internal class CloudWorkspaceLinkCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val sessionProvider: CloudSessionProvider,
    private val transitionCoordinator: CloudLinkedWorkspaceTransitionCoordinator,
    private val appVersion: String
) {
    suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
            requirePostAuthRouteAllowsCloudLinkCompletion(
                linkContext = linkContext,
                recoveryState = recoveryState,
                selection = selection
            )
            if (linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY) {
                return@runExclusive completeGuestLocalRecoveryCloudLink(
                    linkContext = linkContext,
                    recoveryState = requireActiveCloudCredentialRecoveryState(recoveryState = recoveryState),
                    selection = selection
                )
            }
            val resumedGuestUpgrade: CloudWorkspaceSummary? = if (recoveryState == null) {
                resumePendingGuestUpgradeIfNeeded()
            } else {
                null
            }
            if (resumedGuestUpgrade != null) {
                return@runExclusive resumedGuestUpgrade
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession(
                linkContext = linkContext
            )
            requireCloudLinkMatchesCredentialRecoveryBeforeSideEffects(
                recoveryState = recoveryState,
                authenticatedSession = authenticatedSession
            )
            requireWorkspaceSelectionMatchesCredentialRecoveryBeforeSideEffects(
                recoveryState = recoveryState,
                selection = selection
            )
            val selectedWorkspace: CloudWorkspaceSummary = resolveWorkspaceSelection(
                linkContext = linkContext,
                authenticatedSession = authenticatedSession,
                selection = selection
            )
            if (linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE) {
                return@runExclusive completeLinkedCredentialRecoveryCloudLink(
                    authenticatedSession = authenticatedSession,
                    selectedWorkspace = selectedWorkspace
                )
            }
            clearGuestSessionsIfNeeded()
            transitionCoordinator.applyLinkedWorkspace(
                accountSnapshot = authenticatedSession.accountSnapshot,
                bearerToken = authenticatedSession.credentials.idToken,
                selectedWorkspace = selectedWorkspace
            )
            preferencesStore.saveCredentials(authenticatedSession.credentials)
            preferencesStore.clearCloudCredentialRecoveryState()
            selectedWorkspace
        }
    }

    suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            require(linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.NONE) {
                "Guest upgrade cannot run while post-auth recovery is active."
            }
            val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
            if (recoveryState != null) {
                throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
            }
            val resumedGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeIfNeeded()
            if (resumedGuestUpgrade != null) {
                return@runExclusive resumedGuestUpgrade
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession(
                linkContext = linkContext
            )
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val guestSession: StoredGuestAiSession = requireNotNull(
                loadActiveGuestSessionOrNull(
                    preferencesStore = preferencesStore,
                    guestSessionStore = guestSessionStore,
                    configuration = configuration
                )
            ) {
                "Guest AI session is unavailable."
            }
            val guestUpgradeMode: CloudGuestUpgradeMode = requireNotNull(linkContext.guestUpgradeMode) {
                "Guest upgrade requires prepared guest upgrade context."
            }
            val validatedSelection: CloudWorkspaceLinkSelection = validateWorkspaceSelection(
                linkContext = linkContext,
                selection = selection
            )
            preferencesStore.runWithLocalOutboxWritesBlocked(
                reason = "Guest upgrade is finishing. Wait for account linking to complete before changing cards."
            ) {
                drainGuestWorkspaceBeforeUpgradeComplete(
                    configuration = configuration,
                    guestSession = guestSession
                )
                val pendingGuestUpgradeState: PendingGuestUpgradeState = PendingGuestUpgradeState(
                    configuration = configuration,
                    credentials = authenticatedSession.credentials,
                    accountSnapshot = authenticatedSession.accountSnapshot,
                    guestSession = guestSession,
                    guestUpgradeMode = guestUpgradeMode,
                    selection = validatedSelection,
                    completion = null
                )
                preferencesStore.savePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState)
                requireNotNull(resumePendingGuestUpgradeIfNeeded()) {
                    "Pending guest upgrade recovery did not find the saved upgrade state."
                }
            }
        }
    }

    suspend fun completeLinkedWorkspaceTransition(
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val resumedGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeIfNeeded()
            if (resumedGuestUpgrade != null) {
                return@runExclusive resumedGuestUpgrade
            }
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            val selectedWorkspace: CloudWorkspaceSummary = when (selection) {
                is CloudWorkspaceLinkSelection.Existing -> {
                    require(authenticatedSession.accountSnapshot.workspaces.any { workspace ->
                        workspace.workspaceId == selection.workspaceId
                    }) {
                        "Selected workspace is unavailable. Refresh the workspace list and try again."
                    }
                    remoteService.selectWorkspace(
                        apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                        bearerToken = authenticatedSession.credentials.idToken,
                        workspaceId = selection.workspaceId
                    )
                }

                CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    name = "Personal"
                )
            }
            transitionCoordinator.applyLinkedWorkspaceAndSync(
                authenticatedSession = authenticatedSession,
                selectedWorkspace = selectedWorkspace
            )
            selectedWorkspace
        }
    }

    suspend fun resetInvalidCloudCredentialRecoveryState() {
        operationCoordinator.runExclusive {
            val recoveryState: CloudCredentialRecoveryState = preferencesStore.loadCloudCredentialRecoveryState()
                ?: return@runExclusive
            require(recoveryState.reason == CloudCredentialRecoveryReason.INVALID_STORED_STATE) {
                "Invalid cloud credential recovery reset requires an invalid stored recovery state."
            }
            resetCoordinator.disconnectCloudIdentityPreservingLocalState()
            preferencesStore.clearCloudCredentialRecoveryState()
        }
    }

    suspend fun logout() {
        operationCoordinator.runExclusive {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
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

    /**
     * Guest upgrade completion is allowed only after the current guest
     * workspace has completed normal sync and Android has verified that no
     * local guest outbox rows remain to migrate.
     */
    private suspend fun drainGuestWorkspaceBeforeUpgradeComplete(
        configuration: CloudServiceConfiguration,
        guestSession: StoredGuestAiSession
    ) {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val guestWorkspaceId: String = requireNotNull(cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId) {
            "Guest upgrade requires an active guest workspace."
        }
        require(cloudSettings.cloudState == CloudAccountState.GUEST) {
            "Guest upgrade requires guest cloud state before completion."
        }
        require(guestWorkspaceId == guestSession.workspaceId) {
            "Guest upgrade requires current guest workspace '$guestWorkspaceId' to match stored guest session " +
                "'${guestSession.workspaceId}'. Restart the app and try signing in again."
        }

        try {
            runCloudSyncCore(
                cloudSettings = cloudSettings,
                workspaceId = guestWorkspaceId,
                syncSession = CloudSyncSession(
                    apiBaseUrl = configuration.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                ),
                appVersion = appVersion,
                remoteService = remoteService,
                syncLocalStore = syncLocalStore,
                workspaceForkRecoveryMode = CloudWorkspaceForkRecoveryMode.DISABLED
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            throw error
        } catch (error: Exception) {
            if (isCloudIdentityConflictError(error = error)) {
                throw syncBlockedExceptionFor(error = error)
            }
            syncLocalStore.markSyncFailure(
                workspaceId = guestWorkspaceId,
                errorMessage = error.message ?: "Cloud sync failed."
            )
            throw IllegalStateException(
                "Guest upgrade is paused because guest sync did not finish for workspace '$guestWorkspaceId'. " +
                    "Check your connection and try signing in again. Cause=${error.message ?: "Cloud sync failed."}",
                error
            )
        }

        val remainingOutboxCount: Int = syncLocalStore.countOutboxEntries(workspaceId = guestWorkspaceId)
        if (remainingOutboxCount > 0) {
            val message: String = "Guest upgrade is paused because guest workspace '$guestWorkspaceId' still has " +
                "$remainingOutboxCount pending local sync operation(s). Sync again before signing in."
            syncLocalStore.markSyncFailure(
                workspaceId = guestWorkspaceId,
                errorMessage = message
            )
            throw IllegalStateException(message)
        }
    }

    private suspend fun resolveWorkspaceSelection(
        linkContext: CloudWorkspaceLinkContext,
        authenticatedSession: AuthenticatedCloudSession,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        val validatedSelection: CloudWorkspaceLinkSelection = validateWorkspaceSelection(
            linkContext = linkContext,
            selection = selection
        )

        return when (validatedSelection) {
            is CloudWorkspaceLinkSelection.Existing -> remoteService.selectWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                workspaceId = validatedSelection.workspaceId
            )

            CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                name = "Personal"
            )
        }
    }

    private suspend fun completeGuestLocalRecoveryCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        recoveryState: CloudCredentialRecoveryState,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        require(linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY) {
            "Guest local recovery requires the guest recovery post-auth route."
        }
        requireGuestLocalRecoveryAllowsCreateNewCompletion(
            recoveryState = recoveryState,
            selection = selection
        )
        val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession(
            linkContext = linkContext
        )
        loadResumableGuestLocalRecoveryWorkspaceOrNull(
            authenticatedSession = authenticatedSession
        )?.let { resumableWorkspace ->
            preferencesStore.saveCredentials(authenticatedSession.credentials)
            transitionCoordinator.requireTransitionInvariant(
                stage = "before resumed guest local recovery sync",
                expectedWorkspaceId = resumableWorkspace.workspaceId
            )
            transitionCoordinator.runInitialLinkedWorkspaceSync(
                authenticatedSession = authenticatedSession,
                workspaceId = resumableWorkspace.workspaceId
            )
            transitionCoordinator.requireTransitionInvariant(
                stage = "after resumed guest local recovery sync",
                expectedWorkspaceId = resumableWorkspace.workspaceId
            )
            clearGuestSessionsIfNeeded()
            preferencesStore.clearCloudCredentialRecoveryState()
            return resumableWorkspace
        }

        val selectedWorkspace: CloudWorkspaceSummary = remoteService.createWorkspace(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            name = "Personal"
        )
        preferencesStore.saveCredentials(authenticatedSession.credentials)
        transitionCoordinator.applyLinkedWorkspacePreservingLocalData(
            accountSnapshot = authenticatedSession.accountSnapshot,
            selectedWorkspace = selectedWorkspace
        )
        transitionCoordinator.requireTransitionInvariant(
            stage = "after guest local recovery prefs update",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
        transitionCoordinator.runInitialLinkedWorkspaceSync(
            authenticatedSession = authenticatedSession,
            workspaceId = selectedWorkspace.workspaceId
        )
        transitionCoordinator.requireTransitionInvariant(
            stage = "after guest local recovery initial sync",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
        clearGuestSessionsIfNeeded()
        preferencesStore.clearCloudCredentialRecoveryState()
        return selectedWorkspace
    }

    private suspend fun completeLinkedCredentialRecoveryCloudLink(
        authenticatedSession: AuthenticatedCloudSession,
        selectedWorkspace: CloudWorkspaceSummary
    ): CloudWorkspaceSummary {
        preferencesStore.saveCredentials(authenticatedSession.credentials)
        transitionCoordinator.applyLinkedWorkspacePreservingLocalData(
            accountSnapshot = authenticatedSession.accountSnapshot,
            selectedWorkspace = selectedWorkspace
        )
        transitionCoordinator.requireTransitionInvariant(
            stage = "after linked credential recovery prefs update",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
        transitionCoordinator.runInitialLinkedWorkspaceSync(
            authenticatedSession = authenticatedSession,
            workspaceId = selectedWorkspace.workspaceId
        )
        transitionCoordinator.requireTransitionInvariant(
            stage = "after linked credential recovery initial sync",
            expectedWorkspaceId = selectedWorkspace.workspaceId
        )
        clearGuestSessionsIfNeeded()
        preferencesStore.clearCloudCredentialRecoveryState()
        return selectedWorkspace
    }

    private suspend fun loadResumableGuestLocalRecoveryWorkspaceOrNull(
        authenticatedSession: AuthenticatedCloudSession
    ): CloudWorkspaceSummary? {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            return null
        }
        require(cloudSettings.linkedUserId == authenticatedSession.accountSnapshot.userId) {
            "Guest local recovery retry is signed in as '${authenticatedSession.accountSnapshot.userId}', " +
                "but the preserved linked workspace belongs to '${cloudSettings.linkedUserId}'. Start sign-in again."
        }
        val workspaceId: String = requireNotNull(cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId) {
            "Guest local recovery retry requires a preserved linked workspace."
        }
        require(cloudSettings.linkedWorkspaceId == workspaceId) {
            "Guest local recovery retry requires active workspace '$workspaceId' to match linked workspace " +
                "'${cloudSettings.linkedWorkspaceId}'."
        }
        val localWorkspace: WorkspaceEntity = requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = workspaceId)
        ) {
            "Guest local recovery retry requires local workspace '$workspaceId'."
        }
        transitionCoordinator.requireTransitionInvariant(
            stage = "before guest local recovery retry",
            expectedWorkspaceId = workspaceId
        )
        return CloudWorkspaceSummary(
            workspaceId = localWorkspace.workspaceId,
            name = localWorkspace.name,
            createdAtMillis = localWorkspace.createdAtMillis,
            isSelected = true
        )
    }

    private fun clearGuestSessionsIfNeeded() {
        guestSessionStore.clearAllSessions()
    }
}
