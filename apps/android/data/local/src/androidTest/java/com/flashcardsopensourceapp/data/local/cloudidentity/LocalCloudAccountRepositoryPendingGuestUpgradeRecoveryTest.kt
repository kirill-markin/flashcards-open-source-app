package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryPendingGuestUpgradeRecoveryTest {
    private lateinit var environment: CloudIdentityTestEnvironment

    @Before
    fun setUp() = runBlocking {
        environment = CloudIdentityTestEnvironment.create()
    }

    @After
    fun tearDown() {
        environment.close()
    }

    @Test
    fun pendingGuestUpgradeCompletionResumesAfterRestartWhenLinkedHydrationFails() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val storedGuestSession = createStoredGuestAiSession(
            workspaceId = localWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        val baseGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPullResponse {
                throw IllegalStateException("Hydration unavailable.")
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = localWorkspaceId,
                lastSyncCursor = "0",
                lastReviewSequenceId = 0L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = storedGuestSession
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        try {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
            )
            throw AssertionError("Expected guest upgrade finalization to fail during linked hydration.")
        } catch (error: IllegalStateException) {
            assertTrue(
                error.message?.contains(
                    "Guest upgrade completed on the server, but Android could not hydrate linked workspace"
                ) == true
            )
        }

        assertEquals(1, baseGateway.completeGuestUpgradeCalls)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            storedGuestSession,
            environment.guestAiSessionStore.loadAnySession(
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )

        val restartedRuntime = environment.createRestartedCloudAccountRuntime(remoteGateway = baseGateway)

        assertPendingGuestUpgradeBlocksLocalOutboxWrites(
            syncLocalStore = restartedRuntime.syncLocalStore,
            workspaceId = selectedWorkspace.workspaceId
        )

        restartedRuntime.repository.resumePendingAccountDeletionIfNeeded()

        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, baseGateway.prepareGuestUpgradeCalls)
        assertEquals(1, baseGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(true), baseGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
        assertEquals(listOf(true), baseGateway.completeGuestUpgradeSupportsDroppedEntities)
        assertEquals(CloudAccountState.LINKED, restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            selectedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun pendingGuestUpgradeCompletionReplaysAfterBackendCompleteResponseIsLost() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val storedGuestSession = createStoredGuestAiSession(
            workspaceId = guestWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        val baseGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val responseLostGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun completeGuestUpgrade(
                apiBaseUrl: String,
                bearerToken: String,
                guestToken: String,
                selection: CloudGuestUpgradeSelection,
                guestWorkspaceSyncedAndOutboxDrained: Boolean,
                supportsDroppedEntities: Boolean
            ): CloudGuestUpgradeCompletion {
                val pendingGuestUpgradeState = requireNotNull(
                    environment.cloudPreferencesStore.loadPendingGuestUpgrade()
                ) {
                    "Expected drained guest upgrade recovery intent before backend completion."
                }
                assertNull(pendingGuestUpgradeState.completion)
                baseGateway.completeGuestUpgrade(
                    apiBaseUrl = apiBaseUrl,
                    bearerToken = bearerToken,
                    guestToken = guestToken,
                    selection = selection,
                    guestWorkspaceSyncedAndOutboxDrained = guestWorkspaceSyncedAndOutboxDrained,
                    supportsDroppedEntities = supportsDroppedEntities
                )
                throw IllegalStateException("Backend response was lost after guest upgrade completion.")
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = responseLostGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = storedGuestSession
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        try {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
            )
            throw AssertionError("Expected guest upgrade completion response loss.")
        } catch (error: IllegalStateException) {
            assertEquals("Backend response was lost after guest upgrade completion.", error.message)
        }

        val savedPendingGuestUpgradeState = requireNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(savedPendingGuestUpgradeState.completion)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(1, baseGateway.completeGuestUpgradeCalls)

        val replayGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPullResponse {
                requireLinkedRecoveryAuthorization(authorizationHeader = authorizationHeader)
                return baseGateway.bootstrapPull(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }

            override suspend fun pull(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePullResponse {
                requireLinkedRecoveryAuthorization(authorizationHeader = authorizationHeader)
                return baseGateway.pull(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }

            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                requireLinkedRecoveryAuthorization(authorizationHeader = authorizationHeader)
                return baseGateway.push(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }

            override suspend fun pullReviewHistory(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteReviewHistoryPullResponse {
                requireLinkedRecoveryAuthorization(authorizationHeader = authorizationHeader)
                return baseGateway.pullReviewHistory(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }
        }
        val restartedRuntime = environment.createRestartedCloudAccountRuntime(remoteGateway = replayGateway)

        restartedRuntime.repository.resumePendingAccountDeletionIfNeeded()

        assertEquals(2, baseGateway.completeGuestUpgradeCalls)
        assertEquals(1, baseGateway.prepareGuestUpgradeCalls)
        assertEquals(listOf(true, true), baseGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
        assertEquals(listOf(true, true), baseGateway.completeGuestUpgradeSupportsDroppedEntities)
        assertEquals(CloudAccountState.LINKED, restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            selectedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(
            listOf(guestWorkspaceId, selectedWorkspace.workspaceId),
            baseGateway.bootstrapPullWorkspaceIds
        )
        assertNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
    }
}

private suspend fun assertPendingGuestUpgradeBlocksLocalOutboxWrites(
    syncLocalStore: SyncLocalStore,
    workspaceId: String
) {
    try {
        syncLocalStore.enqueueCardUpsert(
            card = createPendingGuestUpgradeBlockedCard(workspaceId = workspaceId),
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        throw AssertionError("Expected pending guest upgrade recovery to block local outbox writes.")
    } catch (error: IllegalStateException) {
        assertEquals(
            "Guest upgrade recovery is pending. Wait for account linking recovery to finish before changing cards.",
            error.message
        )
    }
}

private fun createPendingGuestUpgradeBlockedCard(workspaceId: String): CardEntity {
    return CardEntity(
        cardId = "card-blocked-during-guest-upgrade",
        workspaceId = workspaceId,
        frontText = "Blocked Question",
        backText = "Blocked Answer",
        effortLevel = EffortLevel.MEDIUM,
        dueAtMillis = null,
        createdAtMillis = 500L,
        updatedAtMillis = 500L,
        reps = 0,
        lapses = 0,
        fsrsCardState = FsrsCardState.NEW,
        fsrsStepIndex = null,
        fsrsStability = null,
        fsrsDifficulty = null,
        fsrsLastReviewedAtMillis = null,
        fsrsScheduledDays = null,
        deletedAtMillis = null
    )
}

private fun requireLinkedRecoveryAuthorization(authorizationHeader: String) {
    require(authorizationHeader.startsWith(prefix = "Bearer ", ignoreCase = false)) {
        "Pending guest upgrade recovery must not run guest workspace sync. Authorization='$authorizationHeader'."
    }
}
