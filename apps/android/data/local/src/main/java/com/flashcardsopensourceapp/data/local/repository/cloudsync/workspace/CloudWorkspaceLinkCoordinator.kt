package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
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
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireActiveCloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireCloudLinkMatchesCredentialRecoveryBeforeSideEffects
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireGuestLocalRecoveryAllowsCreateNewCompletion
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requirePostAuthRouteAllowsCloudLinkCompletion
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.requireWorkspaceSelectionMatchesCredentialRecoveryBeforeSideEffects
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestUpgradeDemoCardCapture
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.captureGuestUpgradeDemoCards
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.deleteGuestDemoCardsAfterMergeUpgrade
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.drainGuestWorkspaceBeforeUpgrade
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.resumePendingGuestUpgradeRecoveryIfNeeded
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
    private val appVersion: String,
    private val cardsRepository: CardsRepository,
    private val demoCardDraftProvider: () -> CardDraft,
    private val onGuestUpgradeDemoCardCleanupFailed: (workspaceId: String, error: Exception) -> Unit,
    /**
     * Fired once a sign-in has stored its credentials — a plain one, or the linked-credential
     * recovery — so the analytics guest identity link can run against a fully signed-in install. It
     * must not block: the sign-in still holds the cloud operation lock here, and nothing about the
     * link may delay a user action.
     */
    private val onAnalyticsGuestIdentityLinkRequested: () -> Unit = {}
) {
    suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        retainedWorkspace: CloudWorkspaceSummary?,
        onWorkspaceSelected: suspend (CloudWorkspaceSummary) -> Unit
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
                    selection = selection,
                    retainedWorkspace = retainedWorkspace,
                    onWorkspaceSelected = onWorkspaceSelected
                )
            }
            val resumedGuestUpgrade: CloudWorkspaceSummary? = if (recoveryState == null) {
                resumePendingGuestUpgradeIfNeeded({}, {})
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
            val selectedWorkspace: CloudWorkspaceSummary = retainedWorkspace?.let { workspace ->
                selectRetainedCompletionWorkspace(
                    authenticatedSession = authenticatedSession,
                    workspace = workspace
                )
            } ?: resolveWorkspaceSelection(
                linkContext = linkContext,
                authenticatedSession = authenticatedSession,
                selection = selection
            )
            onWorkspaceSelected(selectedWorkspace)
            if (linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE) {
                return@runExclusive completeLinkedCredentialRecoveryCloudLink(
                    authenticatedSession = authenticatedSession,
                    selectedWorkspace = selectedWorkspace
                )
            }
            // A plain sign-in keeps the stored guest session on purpose: it is the analytics
            // credential this install minted without ever entering guest cloud state, and
            // `CloudGuestSessionCoordinator.linkAnalyticsGuestIdentityToSignedInAccount` claims that
            // guest's analytics history for this account before dropping it. A bound guest upgrade
            // arrives here too and still clears: its guest user id is already the account's, so its
            // events belong to that account without any link.
            //
            // Every cloud-owned guest `loadActiveGuestSessionOrNull` finds produces a non-null
            // upgrade mode, so this condition covers all of them. What it leaves behind is a stored
            // session that lookup filters out — a foreign `apiBaseUrl` or `configurationMode`, an
            // invalid workspace binding — which now survives sign-in until the next
            // `GuestAiSessionStore.loadAnySession` drops it. Widening those filters widens this
            // residue, so a change there has to revisit this branch.
            if (linkContext.guestUpgradeMode != null) {
                clearGuestSessionsIfNeeded()
            }
            transitionCoordinator.applyLinkedWorkspace(
                accountSnapshot = authenticatedSession.accountSnapshot,
                bearerToken = authenticatedSession.credentials.idToken,
                selectedWorkspace = selectedWorkspace
            )
            withContext(Dispatchers.IO) {
                preferencesStore.saveCredentials(authenticatedSession.credentials)
            }
            preferencesStore.clearCloudCredentialRecoveryState()
            // Requested here rather than off a `LINKED` cloud-settings emission, and deliberately
            // after `saveCredentials`: `applyLinkedWorkspace` writes `LINKED` one statement earlier,
            // so an observer woken by that write would run the link before this account's
            // credentials are stored. At best it bails on the missing credentials and this install
            // never claims its analytics guest; with a previous account's credentials still present
            // it would claim that guest for the wrong account, which `analytics.identity_links`
            // cannot repair.
            onAnalyticsGuestIdentityLinkRequested()
            selectedWorkspace
        }
    }

    suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        onGuestCompletionStarted: () -> Unit,
        onGuestCompletionFinished: () -> Unit
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            require(linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.NONE) {
                "Guest upgrade cannot run while post-auth recovery is active."
            }
            val recoveryState: CloudCredentialRecoveryState? = preferencesStore.loadCloudCredentialRecoveryState()
            if (recoveryState != null) {
                throw CloudCredentialRecoveryRequiredException(recoveryState = recoveryState)
            }
            val resumedGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeIfNeeded(onGuestCompletionStarted, onGuestCompletionFinished)
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
            var guestDemoCardCapture: GuestUpgradeDemoCardCapture? = null
            val linkedWorkspace: CloudWorkspaceSummary = preferencesStore.runWithLocalOutboxWritesBlocked(
                reason = "Guest upgrade is finishing. Wait for account linking to complete before changing cards."
            ) {
                drainGuestWorkspaceBeforeUpgrade(
                    preferencesStore = preferencesStore,
                    remoteService = remoteService,
                    syncLocalStore = syncLocalStore,
                    appVersion = appVersion,
                    configuration = configuration,
                    guestSession = guestSession
                )
                if (guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED &&
                    (validatedSelection !is CloudWorkspaceLinkSelection.Existing || !validatedSelection.discardDemoOnly)) {
                    guestDemoCardCapture = captureGuestUpgradeDemoCardsReportingFailure(
                        guestWorkspaceId = guestSession.workspaceId
                    )
                }
                val pendingGuestUpgradeState: PendingGuestUpgradeState = PendingGuestUpgradeState(
                    configuration = configuration,
                    credentials = authenticatedSession.credentials,
                    accountSnapshot = authenticatedSession.accountSnapshot,
                    guestSession = guestSession,
                    guestUpgradeMode = guestUpgradeMode,
                    selection = validatedSelection,
                    completion = null
                )
                withContext(Dispatchers.IO) {
                    preferencesStore.savePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState)
                }
                requireNotNull(resumePendingGuestUpgradeIfNeeded(onGuestCompletionStarted, onGuestCompletionFinished)) {
                    "Pending guest upgrade recovery did not find the saved upgrade state."
                }
            }
            guestDemoCardCapture?.let { capture ->
                deleteGuestDemoCardsReportingFailure(
                    linkedWorkspaceId = linkedWorkspace.workspaceId,
                    capture = capture
                )
            }
            linkedWorkspace
        }
    }

    suspend fun retainConnectedAccount(session: AuthenticatedCloudSession, selectedWorkspaceId: String) {
        operationCoordinator.requireExclusiveOperation(operationName = "Connected account reconciliation")
        transitionCoordinator.retainConnectedAccount(session.accountSnapshot, selectedWorkspaceId)
    }

    suspend fun completeLinkedWorkspaceTransition(
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        return operationCoordinator.runExclusive {
            val resumedGuestUpgrade: CloudWorkspaceSummary? = resumePendingGuestUpgradeIfNeeded({}, {})
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

                is CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    name = linkedCreateWorkspaceName(selection = selection)
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
            resetCoordinator.resetLocalStateForSignOut()
        }
    }

    private suspend fun resumePendingGuestUpgradeIfNeeded(
        onGuestCompletionStarted: () -> Unit,
        onGuestCompletionFinished: () -> Unit
    ): CloudWorkspaceSummary? {
        return resumePendingGuestUpgradeRecoveryIfNeeded(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            guestSessionStore = guestSessionStore,
            appVersion = appVersion,
            onGuestCompletionStarted = onGuestCompletionStarted,
            onGuestCompletionFinished = onGuestCompletionFinished
        )
    }

    private suspend fun captureGuestUpgradeDemoCardsReportingFailure(
        guestWorkspaceId: String
    ): GuestUpgradeDemoCardCapture? {
        return try {
            captureGuestUpgradeDemoCards(
                database = database,
                guestWorkspaceId = guestWorkspaceId,
                demoCardDraft = demoCardDraftProvider()
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            onGuestUpgradeDemoCardCleanupFailed(guestWorkspaceId, error)
            null
        }
    }

    /**
     * Runs once the hydrated linked workspace accepts outbox writes again, so the deletion is an
     * ordinary tombstone that syncs like any other.
     */
    private suspend fun deleteGuestDemoCardsReportingFailure(
        linkedWorkspaceId: String,
        capture: GuestUpgradeDemoCardCapture
    ) {
        try {
            deleteGuestDemoCardsAfterMergeUpgrade(
                database = database,
                cardsRepository = cardsRepository,
                linkedWorkspaceId = linkedWorkspaceId,
                capture = capture
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            onGuestUpgradeDemoCardCleanupFailed(linkedWorkspaceId, error)
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

            is CloudWorkspaceLinkSelection.CreateNew -> remoteService.createWorkspace(
                apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                bearerToken = authenticatedSession.credentials.idToken,
                name = linkedCreateWorkspaceName(selection = validatedSelection)
            )
        }
    }

    private suspend fun selectRetainedCompletionWorkspace(
        authenticatedSession: AuthenticatedCloudSession,
        workspace: CloudWorkspaceSummary
    ): CloudWorkspaceSummary {
        require(authenticatedSession.accountSnapshot.workspaces.any { candidate ->
            candidate.workspaceId == workspace.workspaceId
        }) {
            "The retained sign-in completion workspace is unavailable for this account. Start sign-in again."
        }
        return remoteService.selectWorkspace(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            workspaceId = workspace.workspaceId
        )
    }

    private suspend fun completeGuestLocalRecoveryCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        recoveryState: CloudCredentialRecoveryState,
        selection: CloudWorkspaceLinkSelection,
        retainedWorkspace: CloudWorkspaceSummary?,
        onWorkspaceSelected: suspend (CloudWorkspaceSummary) -> Unit
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
            require(retainedWorkspace == null || retainedWorkspace.workspaceId == resumableWorkspace.workspaceId) {
                "Guest local recovery workspace differs from the retained sign-in completion."
            }
            onWorkspaceSelected(resumableWorkspace)
            withContext(Dispatchers.IO) {
                preferencesStore.saveCredentials(authenticatedSession.credentials)
            }
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

        val selectedWorkspace: CloudWorkspaceSummary = retainedWorkspace?.let { workspace ->
            selectRetainedCompletionWorkspace(
                authenticatedSession = authenticatedSession,
                workspace = workspace
            )
        } ?: remoteService.createWorkspace(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            name = "Personal"
        )
        onWorkspaceSelected(selectedWorkspace)
        withContext(Dispatchers.IO) {
            preferencesStore.saveCredentials(authenticatedSession.credentials)
        }
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

    /**
     * Reached from `CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING`, which
     * `CloudGuestSessionCoordinator` raises for a `LINKED` install with no stored credentials —
     * precisely a state in which an analytics-only guest is commonly stored. So this sign-in keeps
     * that credential and requests its identity link, exactly as a plain sign-in does; only a guest
     * that owns cloud data is retired here.
     */
    private suspend fun completeLinkedCredentialRecoveryCloudLink(
        authenticatedSession: AuthenticatedCloudSession,
        selectedWorkspace: CloudWorkspaceSummary
    ): CloudWorkspaceSummary {
        withContext(Dispatchers.IO) {
            preferencesStore.saveCredentials(authenticatedSession.credentials)
        }
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
        withContext(Dispatchers.IO) { guestSessionStore.clearCloudOwnedSessions() }
        preferencesStore.clearCloudCredentialRecoveryState()
        onAnalyticsGuestIdentityLinkRequested()
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

    /**
     * The identity-boundary wipe, for the routes that end this install's guest outright: a guest
     * upgrade, and the guest-local recovery whose own reason — `GUEST_SESSION_MISSING`, raised only
     * for `GUEST` with no stored session — rules an analytics guest out.
     *
     * `completeLinkedCredentialRecoveryCloudLink` uses [GuestAiSessionStore.clearCloudOwnedSessions]
     * instead: an analytics guest is normal there and still has to be claimed.
     */
    private suspend fun clearGuestSessionsIfNeeded() {
        withContext(Dispatchers.IO) { guestSessionStore.clearAllSessions() }
    }
}
