package com.flashcardsopensourceapp.data.local.repository.cloudsync.account.guestUpgrade

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePushResponse
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.defaultCardType
import com.flashcardsopensourceapp.data.local.model.cards.encodeDefaultCardMetadataJson
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDestinationUnavailableException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.cards.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createOtpChallenge
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
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
class LocalCloudAccountRepositoryGuestUpgradeMergeRequiredTest {
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
    fun unavailableDestinationRetainsGuestUntilAnotherWorkspaceIsChosen() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val configuration = makeOfficialCloudServiceConfiguration()
        val guestSession = createStoredGuestAiSession(
            workspaceId = localWorkspaceId,
            configurationMode = configuration.mode,
            apiBaseUrl = configuration.apiBaseUrl,
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.guestAiSessionStore.saveSession(localWorkspaceId, guestSession)
        val removed = createCloudWorkspaceSummary("workspace-removed", "Travel Spanish", 200L, true)
        val remaining = createCloudWorkspaceSummary("workspace-remaining", "Personal", 100L, false)
        val initialSnapshot = createCloudAccountSnapshot("user-1", "user@example.com", listOf(removed, remaining))
        var snapshot = initialSnapshot
        val removedTransfer = CloudGuestUpgradeSelection.Existing(removed.workspaceId, false)
        val remainingTransfer = CloudGuestUpgradeSelection.Existing(remaining.workspaceId, false)
        val transferRequests = mutableListOf<CloudGuestUpgradeSelection>()
        val baseGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = initialSnapshot,
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
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
                transferRequests.add(selection)
                assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
                assertEquals(guestSession.guestToken, guestToken)
                if (selection == removedTransfer) {
                    snapshot = initialSnapshot.copy(workspaces = listOf(remaining))
                    throw CloudGuestUpgradeDestinationUnavailableException(removed.workspaceId, null)
                }
                return baseGateway.completeGuestUpgrade(
                    apiBaseUrl, bearerToken, guestToken, selection, guestWorkspaceSyncedAndOutboxDrained, supportsDroppedEntities
                )
            }
        }
        val repository = environment.createCloudAccountRepository(remoteGateway)
        val context = repository.verifyCode(createOtpChallenge("user@example.com"), "123456", {})
        val removedSelection = CloudWorkspaceLinkSelection.Existing(removed.workspaceId)
        repeat(2) {
            try {
                // The first request loses the destination after account lookup. The second catches
                // the same missing destination before saving or sending the transfer.
                repository.completeGuestUpgrade(context, removedSelection, {}, {})
                throw AssertionError("Expected the missing destination to be rejected.")
            } catch (error: CloudGuestUpgradeDestinationUnavailableException) {
                assertEquals(removed.workspaceId, error.workspaceId)
            }
            assertEquals(listOf(removedTransfer), transferRequests)
            assertNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
            assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
            assertEquals(guestSession, environment.guestAiSessionStore.loadAnySession(configuration))
            assertEquals(localWorkspaceId, environment.database.cardDao().loadCard(cardId)?.workspaceId)
        }

        val cardsRepository = LocalCardsRepository(
            database = environment.database,
            preferencesStore = environment.cloudPreferencesStore,
            syncLocalStore = environment.createSyncLocalStore()
        )
        val editedCard = CardDraft(frontText = "Edited question", backText = "Edited answer", tags = emptyList())
        cardsRepository.updateCard(cardId = cardId, cardDraft = editedCard, savedTags = emptyList())
        val savedCard = requireNotNull(cardsRepository.observeCard(cardId = cardId).first())
        assertEquals(editedCard.frontText, savedCard.frontText)
        assertEquals(editedCard.backText, savedCard.backText)
        assertEquals(listOf(removedTransfer), transferRequests)

        val aiChatRepository = environment.createAiChatRepository(remoteGateway = remoteGateway)
        val guestChat = aiChatRepository.prepareSessionForAi(workspaceId = localWorkspaceId)
        assertEquals(localWorkspaceId, guestChat.workspaceId)
        assertEquals("Guest ${guestSession.guestToken}", guestChat.authorizationHeader)
        assertEquals(listOf(removedTransfer), transferRequests)

        val refreshed = repository.refreshGuestUpgradeWorkspaces(
            linkContext = context.copy(unavailableGuestUpgradeWorkspaceId = removed.workspaceId),
            socialAttemptId = null
        )
        assertEquals(listOf(remaining), refreshed.workspaces)
        assertEquals(context.credentials, refreshed.credentials)
        val workspace = repository.completeGuestUpgrade(
            refreshed, CloudWorkspaceLinkSelection.Existing(remaining.workspaceId), {}, {}
        )
        assertEquals(remaining.workspaceId, workspace.workspaceId)
        assertNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)

        val linkedChat = aiChatRepository.prepareSessionForAi(workspaceId = remaining.workspaceId)
        assertEquals(remaining.workspaceId, linkedChat.workspaceId)
        assertEquals("Bearer ${context.credentials.idToken}", linkedChat.authorizationHeader)
        assertEquals(listOf(removedTransfer, remainingTransfer), transferRequests)
    }

    @Test
    fun mergeRequiredDrainsGuestOutboxBeforeBackendComplete() = runBlocking {
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
                cardType = defaultCardType,
                metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(110L)),
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
                reviewedAtServerIso = "2026-04-02T15:51:57.000Z",
                reviewedTimeZone = null
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
                affectsReviewSchedule = true,
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
                affectsReviewSchedule = false,
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
                affectsReviewSchedule = false,
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
                affectsReviewSchedule = false,
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
                affectsReviewSchedule = false,
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
            code = "123456",
            onVerified = { }
        )

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId),
            onGuestCompletionStarted = {},
            onGuestCompletionFinished = {}
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
    fun mergeRequiredSkipsBackendWhenGuestOutboxRemains() = runBlocking {
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
        try {
            val linkContext = repository.verifyCode(
                challenge = createOtpChallenge(email = "user@example.com"),
                code = "123456",
                onVerified = { }
            )
            repository.completeGuestUpgrade(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId),
                onGuestCompletionStarted = {},
                onGuestCompletionFinished = {}
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
    fun mergeRequiredDrainsEqualTimestampOutboxInStableOrder() = runBlocking {
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
            code = "123456",
            onVerified = { }
        )

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId),
            onGuestCompletionStarted = {},
            onGuestCompletionFinished = {}
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
        affectsReviewSchedule = true,
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
        affectsReviewSchedule = false,
        attemptCount = 0,
        lastError = null
    )
}
