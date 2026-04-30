package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.room.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.CloudSyncBlockedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
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
class LocalCloudAccountRepositoryCloudIdentityTest {
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
    fun verifyCodePreparesBoundGuestUpgradeWhenMatchingGuestSessionExists() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
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

        assertEquals(CloudGuestUpgradeMode.BOUND, linkContext.guestUpgradeMode)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun prepareVerifiedSignInPrefersSelectedRemoteWorkspaceAndKeepsLocalActiveWorkspace() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "google-review@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-2",
                        name = "Personal",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals("workspace-2", linkContext.preferredWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
    }

    @Test
    fun completeCloudLinkRejectsWorkspaceOutsideCurrentLinkContext() = runBlocking {
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-stale")
            )
            throw AssertionError("Expected completeCloudLink to reject a stale workspace selection.")
        } catch (error: IllegalArgumentException) {
            assertEquals(
                "Selected workspace is unavailable for this sign-in attempt. Start sign-in again.",
                error.message
            )
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
    }

    @Test
    fun verifyCodeSkipsGuestUpgradeWhenStoredSessionTargetsAnotherServerConfiguration() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace-stale",
                configurationMode = CloudServiceConfigurationMode.CUSTOM,
                apiBaseUrl = "https://api.stale.example.com/v1",
                guestToken = "guest-token-stale",
                userId = "guest-user-stale"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertNull(linkContext.guestUpgradeMode)
        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = localWorkspaceId,
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
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
                tags = emptyList()
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
                        tags = emptyList()
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
                    throw createWorkspaceForkRequiredError(
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

    @Test
    fun completeGuestUpgradeMergeRequiredDrainsGuestOutboxBeforeBackendComplete() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val survivingCardId = "card-surviving"
        val droppedDeckId = "deck-dropped"
        val explicitDroppedReviewLogId = "review-explicit-drop"
        val pendingDroppedCardReviewEventId = "review-pending-card-drop"
        val currentSettings = requireNotNull(
            environment.database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(localWorkspaceId)
        ) {
            "Expected workspace scheduler settings for local workspace '$localWorkspaceId'."
        }
        environment.database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = localWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = 1_000L,
                lastSuccessfulSyncAtMillis = 2_000L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        environment.database.cardDao().insertCard(
            CardEntity(
                cardId = survivingCardId,
                workspaceId = localWorkspaceId,
                frontText = "Keep Question",
                backText = "Keep Answer",
                effortLevel = EffortLevel.MEDIUM,
                dueAtMillis = null,
                createdAtMillis = 110L,
                updatedAtMillis = 110L,
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
        )
        environment.database.deckDao().insertDeck(
            DeckEntity(
                deckId = droppedDeckId,
                workspaceId = localWorkspaceId,
                name = "Dropped Deck",
                filterDefinitionJson = JSONObject().put("version", 2).toString(),
                createdAtMillis = 120L,
                updatedAtMillis = 120L,
                deletedAtMillis = null
            )
        )
        environment.database.reviewLogDao().insertReviewLog(
            ReviewLogEntity(
                reviewLogId = explicitDroppedReviewLogId,
                workspaceId = localWorkspaceId,
                cardId = survivingCardId,
                replicaId = "replica-explicit-drop",
                clientEventId = "client-event-explicit-drop",
                rating = ReviewRating.GOOD,
                reviewedAtMillis = 210L,
                reviewedAtServerIso = "2026-04-02T15:51:57.000Z"
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-card-1",
                workspaceId = localWorkspaceId,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                entityType = "card",
                entityId = seededCardId,
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("cardId", seededCardId)
                    .put("frontText", "Question")
                    .put("backText", "Answer")
                    .put("tags", JSONArray())
                    .put("effortLevel", "medium")
                    .put("dueAt", JSONObject.NULL)
                    .put("createdAt", "2026-04-02T15:50:57.000Z")
                    .put("reps", 0)
                    .put("lapses", 0)
                    .put("fsrsCardState", "new")
                    .put("fsrsStepIndex", JSONObject.NULL)
                    .put("fsrsStability", JSONObject.NULL)
                    .put("fsrsDifficulty", JSONObject.NULL)
                    .put("fsrsLastReviewedAt", JSONObject.NULL)
                    .put("fsrsScheduledDays", JSONObject.NULL)
                    .put("deletedAt", JSONObject.NULL)
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 300L,
                attemptCount = 0,
                lastError = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-deck-1",
                workspaceId = localWorkspaceId,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                entityType = "deck",
                entityId = droppedDeckId,
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("deckId", droppedDeckId)
                    .put("name", "Dropped Deck")
                    .put("filterDefinition", JSONObject().put("version", 2))
                    .put("createdAt", "2026-04-02T15:50:57.000Z")
                    .put("deletedAt", JSONObject.NULL)
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 301L,
                attemptCount = 0,
                lastError = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-review-event-card-drop",
                workspaceId = localWorkspaceId,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                entityType = "review_event",
                entityId = pendingDroppedCardReviewEventId,
                operationType = "append",
                payloadJson = JSONObject()
                    .put("reviewEventId", pendingDroppedCardReviewEventId)
                    .put("cardId", seededCardId)
                    .put("clientEventId", "client-event-card-drop")
                    .put("rating", ReviewRating.GOOD.ordinal)
                    .put("reviewedAtClient", "2026-04-02T15:50:57.000Z")
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 302L,
                attemptCount = 0,
                lastError = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-review-event-explicit-drop",
                workspaceId = localWorkspaceId,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                entityType = "review_event",
                entityId = explicitDroppedReviewLogId,
                operationType = "append",
                payloadJson = JSONObject()
                    .put("reviewEventId", explicitDroppedReviewLogId)
                    .put("cardId", survivingCardId)
                    .put("clientEventId", "client-event-explicit-drop")
                    .put("rating", ReviewRating.GOOD.ordinal)
                    .put("reviewedAtClient", "2026-04-02T15:51:57.000Z")
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:51:57.000Z",
                createdAtMillis = 303L,
                attemptCount = 0,
                lastError = null
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            OutboxEntryEntity(
                outboxEntryId = "outbox-settings-1",
                workspaceId = localWorkspaceId,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                entityType = "workspace_scheduler_settings",
                entityId = localWorkspaceId,
                operationType = "upsert",
                payloadJson = JSONObject()
                    .put("algorithm", currentSettings.algorithm)
                    .put("desiredRetention", currentSettings.desiredRetention)
                    .put("learningStepsMinutes", JSONArray(currentSettings.learningStepsMinutesJson))
                    .put("relearningStepsMinutes", JSONArray(currentSettings.relearningStepsMinutesJson))
                    .put("maximumIntervalDays", currentSettings.maximumIntervalDays)
                    .put("enableFuzz", currentSettings.enableFuzz)
                    .toString(),
                clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
                createdAtMillis = 304L,
                attemptCount = 0,
                lastError = null
            )
        )
        val guestWorkspaceId = localWorkspaceId
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
            guestUpgradeReconciliation = createCloudGuestUpgradeReconciliation(
                cardIds = listOf(seededCardId),
                deckIds = listOf(droppedDeckId),
                reviewEventIds = listOf(explicitDroppedReviewLogId)
            )
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

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        val pushedOperations = remoteGateway.pushBodies.single().getJSONArray("operations")

        assertEquals(5, pushedOperations.length())
        assertEquals("outbox-card-1", pushedOperations.getJSONObject(0).getString("operationId"))
        assertEquals("outbox-deck-1", pushedOperations.getJSONObject(1).getString("operationId"))
        assertEquals("outbox-review-event-card-drop", pushedOperations.getJSONObject(2).getString("operationId"))
        assertEquals("outbox-review-event-explicit-drop", pushedOperations.getJSONObject(3).getString("operationId"))
        assertEquals("outbox-settings-1", pushedOperations.getJSONObject(4).getString("operationId"))
        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNull(environment.database.syncStateDao().loadSyncState(localWorkspaceId))
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(listOf(selectedWorkspace.workspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(listOf(true), remoteGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
        assertEquals(listOf(true), remoteGateway.completeGuestUpgradeSupportsDroppedEntities)
        assertEquals(
            listOf(
                "push",
                "pull",
                "pull_review_history",
                "bootstrap_pull",
                "pull_review_history",
                "pull",
                "pull_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }

    @Test
    fun completeGuestUpgradeMergeRequiredDoesNotCallBackendWhenGuestOutboxRemains() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val schedulerSettings = requireNotNull(
            environment.database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(localWorkspaceId)
        ) {
            "Expected workspace scheduler settings for local workspace '$localWorkspaceId'."
        }
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
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun push(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemotePushResponse {
                baseGateway.syncRequestEvents += "push"
                baseGateway.pushBodies += JSONObject(body.toString())
                return RemotePushResponse(operations = emptyList())
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
        environment.database.outboxDao().insertOutboxEntry(
            createGuestUpgradeSchedulerSettingsOutboxEntry(
                outboxEntryId = "outbox-settings-1",
                workspaceId = localWorkspaceId,
                installationId = installationId,
                schedulerSettings = schedulerSettings,
                createdAtMillis = 300L
            )
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
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
            )
            throw AssertionError("Expected guest upgrade to stop while local outbox remains.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message?.contains("still has 1 pending local sync operation") == true)
        }

        assertEquals(0, baseGateway.completeGuestUpgradeCalls)
        assertTrue(baseGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained.isEmpty())
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.outboxDao().countOutboxEntries())
    }

    @Test
    fun completeGuestUpgradeMergeRequiredDrainsEqualTimestampOutboxInStableOrder() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val schedulerSettings = requireNotNull(
            environment.database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(localWorkspaceId)
        ) {
            "Expected workspace scheduler settings for local workspace '$localWorkspaceId'."
        }
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
        environment.database.outboxDao().insertOutboxEntry(
            createGuestUpgradeCardOutboxEntry(
                outboxEntryId = "outbox-z-first",
                workspaceId = localWorkspaceId,
                installationId = installationId,
                cardId = "card-first",
                frontText = "First",
                createdAtMillis = 300L
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            createGuestUpgradeSchedulerSettingsOutboxEntry(
                outboxEntryId = "outbox-a-second",
                workspaceId = localWorkspaceId,
                installationId = installationId,
                schedulerSettings = schedulerSettings,
                createdAtMillis = 300L
            )
        )
        environment.database.outboxDao().insertOutboxEntry(
            createGuestUpgradeCardOutboxEntry(
                outboxEntryId = "outbox-m-third",
                workspaceId = localWorkspaceId,
                installationId = installationId,
                cardId = "card-third",
                frontText = "Third",
                createdAtMillis = 300L
            )
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

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        val pushedOperations = remoteGateway.pushBodies.single().getJSONArray("operations")
        val pushedOperationIds = List(pushedOperations.length()) { index ->
            pushedOperations.getJSONObject(index).getString("operationId")
        }
        assertEquals(listOf("outbox-z-first", "outbox-a-second", "outbox-m-third"), pushedOperationIds)
        assertEquals(localWorkspaceId, pushedOperations.getJSONObject(1).getString("entityId"))
        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertEquals(listOf(true), remoteGateway.completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained)
    }

    @Test
    fun switchLinkedWorkspaceToCreateNewReplacesCurrentLocalWorkspaceWhenRemoteWorkspaceIsEmpty() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val createdWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forCreatedWorkspace(
            createdWorkspace = createdWorkspace,
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        val linkedWorkspace = repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        assertEquals(createdWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
    }

    @Test
    fun renameCurrentWorkspaceTargetsCreatedLinkedWorkspaceAfterCreateNewTransition() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val createdWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forCreatedWorkspace(
            createdWorkspace = createdWorkspace,
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Workspace")

        assertEquals(createdWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Workspace", renamedWorkspace.name)
        assertEquals("Renamed Workspace", environment.database.workspaceDao().loadAnyWorkspace()?.name)
    }

    @Test
    fun completeCloudLinkToExistingWorkspaceReplacesLocalShellAndKeepsRenameTargetAligned() = runBlocking {
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(linkedWorkspace)
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )
        repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId)
        )

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Linked Workspace")

        assertEquals(linkedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(linkedWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Linked Workspace", renamedWorkspace.name)
    }

    @Test
    fun completeLinkedWorkspaceTransitionPreservesBlockedSyncStateWhenInitialSyncBlocks() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredErrorWithoutPublicConflictDetails(
                    path = "/sync/bootstrap",
                    requestId = "request-transition-bootstrap-1"
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val expectedMessage =
            "Cloud sync bootstrap push is blocked for workspace 'workspace-remote': backend did not provide public sync conflict details for automatic local id recovery. Reference: request-transition-bootstrap-1"

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            repository.completeLinkedWorkspaceTransition(
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-remote")
            )
            throw AssertionError("Expected linked workspace transition to fail when initial sync becomes blocked.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message?.contains(expectedMessage) == true)
        }

        val persistedSyncState = requireNotNull(
            environment.database.syncStateDao().loadSyncState(workspaceId = "workspace-remote")
        ) {
            "Expected persisted sync state for workspace 'workspace-remote'."
        }
        val recreatedRepository = environment.createSyncRepository(remoteGateway = FakeCloudRemoteGateway.standard())
        val recreatedStatus = recreatedRepository.observeSyncStatus().first().status

        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("workspace-remote", environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals("workspace-remote", environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(installationId, persistedSyncState.blockedInstallationId)
        assertEquals(expectedMessage, persistedSyncState.lastSyncError)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(recreatedStatus is SyncStatus.Blocked)
        assertEquals(expectedMessage, (recreatedStatus as SyncStatus.Blocked).message)
    }

    @Test
    fun switchLinkedWorkspaceWaitsForForegroundSyncToFinish() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val fetchEntered = CompletableDeferred<Unit>()
        val releaseFetch = CompletableDeferred<Unit>()
        val remoteGateway = FakeCloudRemoteGateway.forBlockingFetch(
            onFetchCloudAccountEntered = fetchEntered,
            blockFetchCloudAccount = releaseFetch
        )
        val cloudRepository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        val syncJob = launch {
            syncRepository.syncNow()
        }
        fetchEntered.await()

        val switchJob = launch {
            cloudRepository.switchLinkedWorkspace(CloudWorkspaceLinkSelection.CreateNew)
        }

        assertEquals(0, remoteGateway.createWorkspaceCalls)

        releaseFetch.complete(Unit)
        switchJob.join()
        syncJob.join()

        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertEquals(
            remoteGateway.createdWorkspaceId,
            environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
    }
}

private fun createWorkspaceForkRequiredError(
    path: String,
    requestId: String,
    entityType: SyncEntityType,
    entityId: String
): CloudRemoteException {
    val remoteEntityType = when (entityType) {
        SyncEntityType.CARD -> "card"
        SyncEntityType.DECK -> "deck"
        SyncEntityType.REVIEW_EVENT -> "review_event"
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> "workspace_scheduler_settings"
    }
    return CloudRemoteException(
        message = "Cloud request failed with status 409 for $path",
        statusCode = 409,
        responseBody = JSONObject()
            .put("code", syncWorkspaceForkRequiredErrorCode)
            .put("requestId", requestId)
            .put(
                "details",
                JSONObject().put(
                    "syncConflict",
                    JSONObject()
                        .put("entityType", remoteEntityType)
                        .put("entityId", entityId)
                        .put("recoverable", true)
                )
            )
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = CloudSyncConflictDetails(
            entityType = entityType,
            entityId = entityId,
            entryIndex = null,
            reviewEventIndex = null,
            recoverable = true,
            conflictingWorkspaceId = null,
            remoteIsEmpty = null
        )
    )
}

private fun createWorkspaceForkRequiredErrorWithoutPublicConflictDetails(
    path: String,
    requestId: String
): CloudRemoteException {
    return CloudRemoteException(
        message = "Cloud request failed with status 409 for $path",
        statusCode = 409,
        responseBody = JSONObject()
            .put("code", syncWorkspaceForkRequiredErrorCode)
            .put("requestId", requestId)
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = null
    )
}

private fun createGuestUpgradeCardOutboxEntry(
    outboxEntryId: String,
    workspaceId: String,
    installationId: String,
    cardId: String,
    frontText: String,
    createdAtMillis: Long
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = installationId,
        entityType = "card",
        entityId = cardId,
        operationType = "upsert",
        payloadJson = JSONObject()
            .put("cardId", cardId)
            .put("frontText", frontText)
            .put("backText", "Back")
            .put("tags", JSONArray())
            .put("effortLevel", "medium")
            .put("dueAt", JSONObject.NULL)
            .put("createdAt", "2026-04-02T15:50:57.000Z")
            .put("reps", 0)
            .put("lapses", 0)
            .put("fsrsCardState", "new")
            .put("fsrsStepIndex", JSONObject.NULL)
            .put("fsrsStability", JSONObject.NULL)
            .put("fsrsDifficulty", JSONObject.NULL)
            .put("fsrsLastReviewedAt", JSONObject.NULL)
            .put("fsrsScheduledDays", JSONObject.NULL)
            .put("deletedAt", JSONObject.NULL)
            .toString(),
        clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
        createdAtMillis = createdAtMillis,
        attemptCount = 0,
        lastError = null
    )
}

private fun createGuestUpgradeSchedulerSettingsOutboxEntry(
    outboxEntryId: String,
    workspaceId: String,
    installationId: String,
    schedulerSettings: WorkspaceSchedulerSettingsEntity,
    createdAtMillis: Long
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = installationId,
        entityType = "workspace_scheduler_settings",
        entityId = workspaceId,
        operationType = "upsert",
        payloadJson = JSONObject()
            .put("algorithm", schedulerSettings.algorithm)
            .put("desiredRetention", schedulerSettings.desiredRetention)
            .put("learningStepsMinutes", JSONArray(schedulerSettings.learningStepsMinutesJson))
            .put("relearningStepsMinutes", JSONArray(schedulerSettings.relearningStepsMinutesJson))
            .put("maximumIntervalDays", schedulerSettings.maximumIntervalDays)
            .put("enableFuzz", schedulerSettings.enableFuzz)
            .toString(),
        clientUpdatedAtIso = "2026-04-02T15:50:57.000Z",
        createdAtMillis = createdAtMillis,
        attemptCount = 0,
        lastError = null
    )
}

private suspend fun assertPendingGuestUpgradeBlocksLocalOutboxWrites(
    syncLocalStore: SyncLocalStore,
    workspaceId: String
) {
    try {
        syncLocalStore.enqueueCardUpsert(
            card = createBlockedGuestUpgradeCard(workspaceId = workspaceId),
            tags = emptyList()
        )
        throw AssertionError("Expected pending guest upgrade recovery to block local outbox writes.")
    } catch (error: IllegalStateException) {
        assertEquals(
            "Guest upgrade recovery is pending. Wait for account linking recovery to finish before changing cards.",
            error.message
        )
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

private fun requireLinkedRecoveryAuthorization(authorizationHeader: String) {
    require(authorizationHeader.startsWith(prefix = "Bearer ", ignoreCase = false)) {
        "Pending guest upgrade recovery must not run guest workspace sync. Authorization='$authorizationHeader'."
    }
}
