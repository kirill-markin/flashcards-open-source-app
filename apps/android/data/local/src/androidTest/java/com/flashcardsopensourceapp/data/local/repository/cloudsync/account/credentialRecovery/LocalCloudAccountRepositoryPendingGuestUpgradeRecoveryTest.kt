package com.flashcardsopensourceapp.data.local.repository.cloudsync.account.credentialRecovery

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.guest.CloudGuestUpgradeRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.cards.defaultCardType
import com.flashcardsopensourceapp.data.local.model.cards.encodeDefaultCardMetadataJson
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createOtpChallenge
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import java.net.SocketTimeoutException
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
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
    fun pendingUpgradeResumesAfterRestartWhenLinkedHydrationFails() = runBlocking {
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
            code = "123456",
            onVerified = { }
        )

        try {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId),
                onGuestCompletionStarted = {},
                onGuestCompletionFinished = {}
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
                configuration = com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration()
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
                configuration = com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun pendingUpgradeReplaysAfterBackendCompleteResponseLoss() = runBlocking {
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
            code = "123456",
            onVerified = { }
        )

        try {
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId),
                onGuestCompletionStarted = {},
                onGuestCompletionFinished = {}
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

        val unavailableWorkspaceResponse = createMissingGuestUpgradeWorkspaceApi(
            workspaceId = selectedWorkspace.workspaceId,
            responseBody = """{"error":"Workspace not found","code":"WORKSPACE_NOT_FOUND"}"""
        )
        val unavailableWorkspaceGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun completeGuestUpgrade(
                apiBaseUrl: String,
                bearerToken: String,
                guestToken: String,
                selection: CloudGuestUpgradeSelection,
                guestWorkspaceSyncedAndOutboxDrained: Boolean,
                supportsDroppedEntities: Boolean
            ): CloudGuestUpgradeCompletion {
                return unavailableWorkspaceResponse.completeGuestUpgrade(
                    apiBaseUrl, bearerToken, guestToken, selection, guestWorkspaceSyncedAndOutboxDrained,
                    supportsDroppedEntities
                )
            }
        }
        val unavailableWorkspaceRuntime = environment.createRestartedCloudAccountRuntime(unavailableWorkspaceGateway)
        try {
            unavailableWorkspaceRuntime.repository.resumePendingAccountDeletionIfNeeded()
            throw AssertionError("Expected the replayed workspace to be unavailable.")
        } catch (error: CloudRemoteException) {
            assertEquals(404, error.statusCode)
            assertEquals("WORKSPACE_NOT_FOUND", error.errorCode)
        }
        assertEquals(savedPendingGuestUpgradeState, unavailableWorkspaceRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(CloudAccountState.GUEST, unavailableWorkspaceRuntime.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            storedGuestSession,
            environment.guestAiSessionStore.loadAnySession(savedPendingGuestUpgradeState.configuration)
        )

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
    fun backgroundResumeRejectsMissingDestinationAndAllowsAnotherTransfer() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val cardId = environment.seedWorkspaceData(workspaceId = guestWorkspaceId)
        val configuration = makeOfficialCloudServiceConfiguration()
        val guestSession = createStoredGuestAiSession(
            workspaceId = guestWorkspaceId,
            configurationMode = configuration.mode,
            apiBaseUrl = configuration.apiBaseUrl,
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.guestAiSessionStore.saveSession(guestWorkspaceId, guestSession)
        val removed = createCloudWorkspaceSummary("workspace-removed", "Removed Workspace", 200L, true)
        val remaining = createCloudWorkspaceSummary("workspace-remaining", "Remaining Workspace", 100L, false)
        val initialSnapshot = createCloudAccountSnapshot("user-1", "user@example.com", listOf(removed, remaining))
        var snapshot = initialSnapshot
        val removedSelection = CloudWorkspaceLinkSelection.Existing(removed.workspaceId)
        val removedTransfer = CloudGuestUpgradeSelection.Existing(removed.workspaceId, false)
        val remainingTransfer = CloudGuestUpgradeSelection.Existing(remaining.workspaceId, false)
        val transfers = mutableListOf<CloudGuestUpgradeSelection>()
        val baseGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = initialSnapshot,
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )
        val missingWorkspaceApi = createMissingGuestUpgradeWorkspaceApi(
            workspaceId = removed.workspaceId,
            responseBody = """
                {"error":"Workspace not found","code":"WORKSPACE_NOT_FOUND",
                 "details":{"guestUpgradeDestinationUnavailable":true}}
            """.trimIndent()
        )
        val remoteGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String): CloudAccountSnapshot {
                return snapshot
            }

            override suspend fun completeGuestUpgrade(
                apiBaseUrl: String,
                bearerToken: String,
                guestToken: String,
                selection: CloudGuestUpgradeSelection,
                guestWorkspaceSyncedAndOutboxDrained: Boolean,
                supportsDroppedEntities: Boolean
            ): CloudGuestUpgradeCompletion {
                transfers.add(selection)
                assertEquals(guestSession.guestToken, guestToken)
                if (selection == removedTransfer) {
                    if (transfers.size == 1) {
                        snapshot = initialSnapshot.copy(workspaces = listOf(remaining))
                        throw SocketTimeoutException("Guest upgrade completion timed out.")
                    }
                    return missingWorkspaceApi.completeGuestUpgrade(
                        apiBaseUrl, bearerToken, guestToken, selection, guestWorkspaceSyncedAndOutboxDrained,
                        supportsDroppedEntities
                    )
                }
                return baseGateway.completeGuestUpgrade(
                    apiBaseUrl, bearerToken, guestToken, selection, guestWorkspaceSyncedAndOutboxDrained, supportsDroppedEntities
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway)
        val context = repository.verifyCode(createOtpChallenge("user@example.com"), "123456", {})
        try {
            repository.completeGuestUpgrade(context, removedSelection, {}, {})
            throw AssertionError("Expected the original transfer to time out.")
        } catch (error: SocketTimeoutException) {
            assertEquals("Guest upgrade completion timed out.", error.message)
        }
        val pending = requireNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(removedSelection, pending.selection)
        assertNull(pending.completion)
        assertEquals(listOf(removedTransfer), transfers)
        val guestCard = requireNotNull(environment.database.cardDao().loadCard(cardId))

        repository.resumePendingAccountDeletionIfNeeded()

        assertNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(listOf(removedTransfer, removedTransfer), transfers)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(guestSession, environment.guestAiSessionStore.loadAnySession(configuration))
        assertEquals(guestCard, environment.database.cardDao().loadCard(cardId))

        repository.resumePendingAccountDeletionIfNeeded()
        assertEquals(listOf(removedTransfer, removedTransfer), transfers)
        assertEquals(0, baseGateway.deleteAccountCalls)

        val refreshedContext = repository.refreshGuestUpgradeWorkspaces(context, socialAttemptId = null)
        assertEquals(listOf(remaining), refreshedContext.workspaces)
        val workspace = repository.completeGuestUpgrade(
            refreshedContext, CloudWorkspaceLinkSelection.Existing(remaining.workspaceId), {}, {}
        )
        assertEquals(remaining.workspaceId, workspace.workspaceId)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(listOf(removedTransfer, removedTransfer, remainingTransfer), transfers)
    }
}

private fun createMissingGuestUpgradeWorkspaceApi(workspaceId: String, responseBody: String): CloudGuestUpgradeRemoteApi {
    return CloudGuestUpgradeRemoteApi(CloudJsonHttpClient(
        OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertTrue(request.url.encodedPath.endsWith("/guest-auth/upgrade/complete"))
            val requestBody = Buffer().also { requireNotNull(request.body).writeTo(it) }
            val selection = JSONObject(requestBody.readUtf8()).getJSONObject("selection")
            assertEquals(workspaceId, selection.getString("workspaceId"))
            Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(404)
                .message("Not Found")
                .body(responseBody.toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
    ))
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
        cardType = defaultCardType,
        metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(500L)),
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
