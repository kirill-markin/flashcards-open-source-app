package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.room.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.repository.cloudsync.CloudSyncBlockedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
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
class LocalCloudAccountRepositoryGuestUpgradeDrainTest {
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
    fun completeGuestUpgradeDrainsGuestSyncAndLinksSelectedWorkspace() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        val linkedWorkspace = repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        assertEquals(selectedWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(selectedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals("user@example.com", environment.cloudPreferencesStore.currentCloudSettings().linkedEmail)
        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(1, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(guestWorkspaceId, selectedWorkspace.workspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(listOf(true), remoteGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
    }

    @Test
    fun completeGuestUpgradeBlocksOutboxWritesWhileGuestDrainIsRunning() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val guestDrainEntered = CompletableDeferred<Unit>()
        val releaseGuestDrain = CompletableDeferred<Unit>()
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
                if (authorizationHeader == "Guest guest-token" && workspaceId == guestWorkspaceId) {
                    guestDrainEntered.complete(Unit)
                    releaseGuestDrain.await()
                }
                return baseGateway.bootstrapPull(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val syncLocalStore = environment.createSyncLocalStore()
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        val upgradeResult = async {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
            )
        }
        guestDrainEntered.await()

        try {
            syncLocalStore.enqueueCardUpsert(
                card = createBlockedGuestUpgradeCard(workspaceId = guestWorkspaceId),
                tags = emptyList(),
                affectsReviewSchedule = true
            )
            throw AssertionError("Expected guest upgrade drain to block local outbox writes.")
        } catch (error: IllegalStateException) {
            assertEquals(
                "Guest upgrade is finishing. Wait for account linking to complete before changing cards.",
                error.message
            )
        }

        assertEquals(0, environment.database.outboxDao().countOutboxEntries())

        releaseGuestDrain.complete(Unit)

        assertEquals(selectedWorkspace.workspaceId, upgradeResult.await().workspaceId)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(1, baseGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(true), baseGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
    }

    @Test
    fun completeGuestUpgradeWaitsForInFlightOutboxMutationTransactionToCommitBeforeDrain() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val transactionStarted = CompletableDeferred<Unit>()
        val releaseOutboxInsert = CompletableDeferred<Unit>()
        val outboxInsertedInsideTransaction = CompletableDeferred<Unit>()
        val releaseTransactionCommit = CompletableDeferred<Unit>()
        val guestDrainEntered = CompletableDeferred<Unit>()
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
                if (authorizationHeader == "Guest guest-token" && workspaceId == guestWorkspaceId) {
                    guestDrainEntered.complete(Unit)
                }
                return baseGateway.bootstrapPull(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val syncLocalStore = environment.createSyncLocalStore()
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        val mutationResult = async {
            environment.cloudPreferencesStore.runWithLocalOutboxMutationAllowed {
                environment.database.withTransaction {
                    transactionStarted.complete(Unit)
                    releaseOutboxInsert.await()
                    syncLocalStore.enqueueCardUpsert(
                        card = createBlockedGuestUpgradeCard(workspaceId = guestWorkspaceId),
                        tags = emptyList(),
                        affectsReviewSchedule = true
                    )
                    outboxInsertedInsideTransaction.complete(Unit)
                    releaseTransactionCommit.await()
                }
            }
        }
        transactionStarted.await()

        val upgradeResult = async {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
            )
        }

        assertNull(withTimeoutOrNull(timeMillis = 100L) { guestDrainEntered.await() })

        releaseOutboxInsert.complete(Unit)
        outboxInsertedInsideTransaction.await()
        assertNull(withTimeoutOrNull(timeMillis = 100L) { guestDrainEntered.await() })

        releaseTransactionCommit.complete(Unit)
        mutationResult.await()

        guestDrainEntered.await()
        assertEquals(selectedWorkspace.workspaceId, upgradeResult.await().workspaceId)

        val pushedOperations = baseGateway.pushBodies.single().getJSONArray("operations")
        assertEquals(1, pushedOperations.length())
        assertEquals("card-blocked-during-guest-upgrade", pushedOperations.getJSONObject(0).getString("entityId"))
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(listOf(true), baseGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
    }

    @Test
    fun completeGuestUpgradeDoesNotForkGuestIdentityWhenGuestDrainRequiresWorkspaceFork() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val seededCardId = environment.seedWorkspaceData(workspaceId = guestWorkspaceId)
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val baseGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPush(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPushResponse {
                baseGateway.syncRequestEvents += "bootstrap_push"
                baseGateway.bootstrapPushBodies += JSONObject(body.toString())
                if (authorizationHeader == "Guest guest-token" && workspaceId == guestWorkspaceId) {
                    throw createSyncWorkspaceForkRequiredError(
                        path = "/sync/bootstrap",
                        requestId = "request-guest-drain-fork",
                        entityType = SyncEntityType.CARD,
                        entityId = seededCardId
                    )
                }
                return RemoteBootstrapPushResponse(
                    appliedEntriesCount = 0,
                    bootstrapHotChangeId = 0L
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
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
            throw AssertionError("Expected guest upgrade drain to block workspace fork recovery.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message?.contains("Guest upgrade is paused because guest sync did not finish") == true)
            assertTrue(error.cause is CloudSyncBlockedException)
            assertTrue(
                error.cause?.message?.contains(
                    "automatic workspace identity fork recovery is disabled for this sync"
                ) == true
            )
        }

        val persistedSyncState = requireNotNull(
            environment.database.syncStateDao().loadSyncState(workspaceId = guestWorkspaceId)
        ) {
            "Expected guest sync state to be blocked after fork recovery was disabled."
        }
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(guestWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(0, baseGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(guestWorkspaceId), baseGateway.bootstrapPullWorkspaceIds)
        assertEquals(1, baseGateway.bootstrapPushBodies.size)
        assertEquals(installationId, persistedSyncState.blockedInstallationId)
        assertEquals(
            "Cloud sync bootstrap push is blocked for workspace '$guestWorkspaceId': " +
                "automatic workspace identity fork recovery is disabled for this sync. " +
                "Reference: request-guest-drain-fork",
            persistedSyncState.lastSyncError
        )
    }

    @Test
    fun completeGuestUpgradeBoundDoesNotCallBackendWhenGuestSyncIsBlocked() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val preservedSyncState = SyncStateEntity(
            workspaceId = localWorkspaceId,
            lastSyncCursor = "cursor-123",
            lastReviewSequenceId = 456L,
            hasHydratedHotState = true,
            hasHydratedReviewHistory = true,
            pendingReviewHistoryImport = false,
            lastSyncAttemptAtMillis = 1_000L,
            lastSuccessfulSyncAtMillis = 2_000L,
            lastSyncError = "sync is blocked",
            blockedInstallationId = installationId
        )
        environment.database.syncStateDao().insertSyncState(preservedSyncState)
        val boundWorkspace = createCloudWorkspaceSummary(
            workspaceId = localWorkspaceId,
            name = "Bound Workspace",
            createdAtMillis = 400L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "guest-user",
                email = "user@example.com",
                workspaces = listOf(boundWorkspace)
            ),
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = localWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )
        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        try {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = localWorkspaceId)
            )
            throw AssertionError("Expected bound guest upgrade to stop before backend completion.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message?.contains("Guest upgrade is paused because guest sync did not finish") == true)
        }

        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(preservedSyncState, environment.database.syncStateDao().loadSyncState(localWorkspaceId))
        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())
        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertTrue(remoteGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained.isEmpty())
        assertTrue(remoteGateway.completeGuestUpgradeSupportsDroppedEntities.isEmpty())
    }
}

private fun createBlockedGuestUpgradeCard(workspaceId: String): CardEntity {
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
