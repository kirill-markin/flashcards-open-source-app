package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncRepositoryReviewHistoryImportRecoveryTest {
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
    fun syncKeepsReviewHistoryImportMarkerWhenBootstrapPushCrashesAfterRemoteCommit() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val baseGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val interruptedGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun bootstrapPush(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteBootstrapPushResponse {
                val preCommitSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
                    "Expected pending review-history import marker before bootstrap push."
                }
                assertTrue(preCommitSyncState.pendingReviewHistoryImport)
                assertFalse(preCommitSyncState.hasHydratedReviewHistory)

                baseGateway.bootstrapPush(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    workspaceId = workspaceId,
                    body = body
                )

                val postCommitSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
                    "Expected pending review-history import marker after bootstrap push commit."
                }
                assertTrue(postCommitSyncState.pendingReviewHistoryImport)
                assertFalse(postCommitSyncState.hasHydratedReviewHistory)
                throw IllegalStateException("Simulated process death after bootstrap hot state commit.")
            }
        }
        val interruptedRepository = environment.createSyncRepository(remoteGateway = interruptedGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            interruptedRepository.syncNow()
            throw AssertionError("Expected interrupted bootstrap push.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated process death after bootstrap hot state commit.", error.message)
        }

        val interruptedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after interrupted bootstrap push."
        }
        assertTrue(interruptedSyncState.pendingReviewHistoryImport)
        assertFalse(interruptedSyncState.hasHydratedReviewHistory)
        assertEquals(1, baseGateway.bootstrapPushBodies.size)
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())

        val resumedGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(false),
            importReviewHistoryErrors = emptyList()
        )
        val resumedRepository = environment.createSyncRepository(remoteGateway = resumedGateway)

        resumedRepository.syncNow()

        val importedReviewEvent = resumedGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after resumed review-history import."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(listOf(workspaceId), resumedGateway.bootstrapPullWorkspaceIds)
        assertTrue(resumedGateway.bootstrapPushBodies.isEmpty())
        assertEquals(
            listOf(
                "bootstrap_pull",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            resumedGateway.syncRequestEvents
        )
    }

    @Test
    fun syncRetriesBootstrapPushWhenPendingReviewHistoryMarkerSurvivesFailedPush() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true),
            bootstrapPushErrors = listOf(IllegalStateException("Simulated bootstrap push failure before commit."))
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
            throw AssertionError("Expected failed bootstrap push.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated bootstrap push failure before commit.", error.message)
        }

        val failedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after failed bootstrap push."
        }
        assertTrue(failedSyncState.pendingReviewHistoryImport)
        assertFalse(failedSyncState.hasHydratedReviewHistory)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertTrue(remoteGateway.importReviewHistoryBodies.isEmpty())

        syncRepository.syncNow()

        val importedReviewEvent = remoteGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after retrying bootstrap push."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }

    @Test
    fun syncResumesReviewHistoryImportAfterBootstrapPushCrashWhenRemoteIsNoLongerEmpty() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val baseGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val interruptedGateway = object : CloudRemoteGateway by baseGateway {
            override suspend fun importReviewHistory(
                apiBaseUrl: String,
                authorizationHeader: String,
                workspaceId: String,
                body: JSONObject
            ): RemoteReviewHistoryImportResponse {
                throw IllegalStateException("Simulated process death before review history import.")
            }
        }
        val interruptedRepository = environment.createSyncRepository(remoteGateway = interruptedGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            interruptedRepository.syncNow()
            throw AssertionError("Expected interrupted review-history import.")
        } catch (error: IllegalStateException) {
            assertEquals("Simulated process death before review history import.", error.message)
        }

        val interruptedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after interrupted bootstrap push."
        }
        assertTrue(interruptedSyncState.pendingReviewHistoryImport)
        assertFalse(interruptedSyncState.hasHydratedReviewHistory)
        assertEquals(1, baseGateway.bootstrapPushBodies.size)
        assertTrue(baseGateway.importReviewHistoryBodies.isEmpty())

        val resumedGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(false),
            importReviewHistoryErrors = emptyList()
        )
        val resumedRepository = environment.createSyncRepository(remoteGateway = resumedGateway)

        resumedRepository.syncNow()

        val importedReviewEvent = resumedGateway.importReviewHistoryBodies.single()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val completedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after resumed review-history import."
        }

        assertEquals("review-$workspaceId", importedReviewEvent.getString("reviewEventId"))
        assertEquals("card-$workspaceId", importedReviewEvent.getString("cardId"))
        assertFalse(completedSyncState.pendingReviewHistoryImport)
        assertTrue(completedSyncState.hasHydratedReviewHistory)
        assertEquals(listOf(workspaceId), resumedGateway.bootstrapPullWorkspaceIds)
        assertTrue(resumedGateway.bootstrapPushBodies.isEmpty())
        assertEquals(
            listOf(
                "bootstrap_pull",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            resumedGateway.syncRequestEvents
        )
    }

    @Test
    fun syncRetriesReviewHistoryImportAfterReIdWithoutRestartingBootstrap() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val originalReviewEventId = "review-$workspaceId"
        val remoteGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, false),
            importReviewHistoryErrors = listOf(
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-1",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        syncRepository.syncNow()

        val recoveredReviewLog = environment.database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId).single()
        val firstImportedReviewEvent = remoteGateway.importReviewHistoryBodies.first()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val secondImportedReviewEvent = remoteGateway.importReviewHistoryBodies.last()
            .getJSONArray("reviewEvents")
            .getJSONObject(0)
        val persistedSyncState = requireNotNull(environment.database.syncStateDao().loadSyncState(workspaceId)) {
            "Expected sync state for workspace '$workspaceId' after review-history import recovery."
        }

        assertEquals(SyncStatus.Idle, syncRepository.observeSyncStatus().first().status)
        assertNotNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(seededCardId, recoveredReviewLog.cardId)
        assertTrue(recoveredReviewLog.reviewLogId != originalReviewEventId)
        assertEquals(originalReviewEventId, firstImportedReviewEvent.getString("reviewEventId"))
        assertEquals(recoveredReviewLog.reviewLogId, secondImportedReviewEvent.getString("reviewEventId"))
        assertEquals(1, remoteGateway.bootstrapPullWorkspaceIds.size)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(2, remoteGateway.importReviewHistoryBodies.size)
        assertTrue(persistedSyncState.hasHydratedReviewHistory)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "import_review_history",
                "pull",
                "pull_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }

    @Test
    fun syncBlocksRepeatedReviewHistoryImportForkConflictAfterAutomaticRecovery() = runBlocking {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = workspaceId)
        val originalReviewEventId = "review-$workspaceId"
        val remoteGateway = FakeCloudRemoteGateway.forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, false),
            importReviewHistoryErrors = listOf(
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-1",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
                ),
                createSyncWorkspaceForkRequiredError(
                    path = "/sync/review-history/import",
                    requestId = "request-review-history-2",
                    entityType = SyncEntityType.REVIEW_EVENT,
                    entityId = originalReviewEventId
                )
            )
        )
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: Exception) {
        }

        val syncStatus = syncRepository.observeSyncStatus().first().status

        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud sync review history import is blocked for workspace '$workspaceId': automatic local id recovery already repaired review_event '$originalReviewEventId' in this sync attempt and the backend still reports the same conflict. Reference: request-review-history-2",
            (syncStatus as SyncStatus.Blocked).message
        )
        assertEquals(1, remoteGateway.bootstrapPullWorkspaceIds.size)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(2, remoteGateway.importReviewHistoryBodies.size)
        assertEquals(
            listOf(
                "bootstrap_pull",
                "bootstrap_push",
                "import_review_history",
                "import_review_history"
            ),
            remoteGateway.syncRequestEvents
        )
    }
}
