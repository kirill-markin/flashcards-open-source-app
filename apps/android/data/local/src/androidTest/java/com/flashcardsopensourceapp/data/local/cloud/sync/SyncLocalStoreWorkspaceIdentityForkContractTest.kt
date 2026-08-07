package com.flashcardsopensourceapp.data.local.cloud.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedCardId
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedDeckId
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedMediaAssetId
import com.flashcardsopensourceapp.data.local.cloud.identity.forkedReviewEventId
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.model.cards.defaultCardType
import com.flashcardsopensourceapp.data.local.model.cards.encodeDefaultCardMetadataJson
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.managedImageMarkdownReference
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.sync.SyncOperationPayload
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncLocalStoreWorkspaceIdentityForkContractTest {
    private lateinit var runtime: SyncLocalStoreTestRuntime
    private val database: AppDatabase
        get() = runtime.database
    private val syncLocalStore: SyncLocalStore
        get() = runtime.syncLocalStore

    @Before
    fun setUp(): Unit {
        runtime = createSyncLocalStoreTestRuntime()
    }

    @After
    fun tearDown(): Unit {
        if (::runtime.isInitialized) {
            closeSyncLocalStoreTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun forkWorkspaceIdentityRewritesIdsReferencesAndResetsSyncState(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            frontText = "Front",
            backText = "Back",
            cardType = defaultCardType,
            metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(1L)),
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
            reps = 1,
            lapses = 0,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = 3.5,
            fsrsDifficulty = 4.0,
            fsrsLastReviewedAtMillis = 3L,
            fsrsScheduledDays = 5,
            deletedAtMillis = 9L
        )
        val originalDeck = DeckEntity(
            deckId = "deck-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            name = "Primary",
            filterDefinitionJson = JSONObject().put("version", 2).toString(),
            createdAtMillis = 4L,
            updatedAtMillis = 5L,
            deletedAtMillis = 10L
        )
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 6L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z",
            reviewedTimeZone = null
        )
        database.cardDao().insertCard(originalCard)
        database.deckDao().insertDeck(originalDeck)
        database.tagDao().insertTags(
            listOf(
                TagEntity(
                    tagId = "tag-1",
                    workspaceId = syncLocalStoreContractWorkspaceId,
                    name = "android"
                )
            )
        )
        database.tagDao().insertCardTags(
            listOf(
                CardTagEntity(
                    cardId = originalCard.cardId,
                    tagId = "tag-1"
                )
            )
        )
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = listOf("android"),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueDeckUpsert(deck = originalDeck)
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceCardId = originalCard.cardId
        )
        val expectedForkedDeckId = forkedDeckId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceDeckId = originalDeck.deckId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceReviewEventId = originalReviewLog.reviewLogId
        )
        val forkedCard = requireNotNull(database.cardDao().loadCard(expectedForkedCardId))
        val forkedDeck = requireNotNull(database.deckDao().loadDeck(expectedForkedDeckId))
        val forkedReviewLog = database.reviewLogDao().loadReviewLogs().single()
        val forkedCardWithRelations = database.cardDao().observeCardsWithRelations().first().single()
        val forkedOutboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = "workspace-2")

        assertNull(database.cardDao().loadCard(originalCard.cardId))
        assertNull(database.deckDao().loadDeck(originalDeck.deckId))
        assertEquals("workspace-2", database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals("workspace-2", forkedCard.workspaceId)
        assertEquals(originalCard.frontText, forkedCard.frontText)
        assertEquals(originalCard.deletedAtMillis, forkedCard.deletedAtMillis)
        assertEquals("workspace-2", forkedDeck.workspaceId)
        assertEquals(originalDeck.deletedAtMillis, forkedDeck.deletedAtMillis)
        assertEquals(expectedForkedReviewEventId, forkedReviewLog.reviewLogId)
        assertEquals(expectedForkedCardId, forkedReviewLog.cardId)
        assertEquals("workspace-2", forkedReviewLog.workspaceId)
        assertEquals(listOf("android"), forkedCardWithRelations.tags.map(TagEntity::name))
        assertEquals(
            setOf(expectedForkedCardId, expectedForkedDeckId, expectedForkedReviewEventId),
            forkedOutboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card).payload.cardId
        )
        assertEquals(
            expectedForkedDeckId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.DECK }
                .operation.payload as SyncOperationPayload.Deck).payload.deckId
        )
        assertEquals(
            expectedForkedReviewEventId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.reviewEventId
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.cardId
        )
        assertNull(database.syncStateDao().loadSyncState(syncLocalStoreContractWorkspaceId))
        assertEquals(
            SyncStateEntity(
                workspaceId = "workspace-2",
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            ),
            database.syncStateDao().loadSyncState("workspace-2")
        )
        assertEquals(
            "workspace-2",
            database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings("workspace-2")?.workspaceId
        )
    }

    @Test
    fun forkWorkspaceIdentityForksRegisteredMediaAssetsAndRewritesCardReferences(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val activeMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = firstContractMediaSha256,
            deletedAtMillis = null
        )
        val tombstonedMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-2",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = secondContractMediaSha256,
            deletedAtMillis = 42L
        )
        database.mediaAssetDao().insertMediaAssets(
            mediaAssets = listOf(activeMediaAsset, tombstonedMediaAsset)
        )
        val originalCard = createContractCardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            frontText = "Front " + managedImageMarkdownReference(
                mediaAssetId = activeMediaAsset.mediaAssetId,
                altText = "Diagram"
            ),
            backText = "Back " + managedImageMarkdownReference(
                mediaAssetId = tombstonedMediaAsset.mediaAssetId,
                altText = "Answer"
            )
        )
        database.cardDao().insertCard(originalCard)
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = emptyList(),
            affectsReviewSchedule = false
        )

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )

        val expectedForkedActiveMediaAssetId = forkedMediaAssetId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceMediaAssetId = activeMediaAsset.mediaAssetId
        )
        val expectedForkedTombstonedMediaAssetId = forkedMediaAssetId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceMediaAssetId = tombstonedMediaAsset.mediaAssetId
        )
        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceCardId = originalCard.cardId
        )
        val forkedActiveMediaAsset = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = expectedForkedActiveMediaAssetId)
        )
        val forkedTombstonedMediaAsset = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = expectedForkedTombstonedMediaAssetId)
        )
        val forkedCard = requireNotNull(database.cardDao().loadCard(expectedForkedCardId))
        val forkedCardPayload = (
            syncLocalStore.loadOutboxEntries(workspaceId = "workspace-2")
                .single { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card
            ).payload

        assertNull(database.mediaAssetDao().loadMediaAsset(mediaAssetId = activeMediaAsset.mediaAssetId))
        assertNull(database.mediaAssetDao().loadMediaAsset(mediaAssetId = tombstonedMediaAsset.mediaAssetId))
        assertEquals("workspace-2", forkedActiveMediaAsset.workspaceId)
        assertEquals(activeMediaAsset.sha256, forkedActiveMediaAsset.sha256)
        assertEquals(activeMediaAsset.mimeType, forkedActiveMediaAsset.mimeType)
        assertEquals(activeMediaAsset.sizeBytes, forkedActiveMediaAsset.sizeBytes)
        assertEquals(activeMediaAsset.lastModifiedByReplicaId, forkedActiveMediaAsset.lastModifiedByReplicaId)
        assertEquals(activeMediaAsset.clientUpdatedAtMillis, forkedActiveMediaAsset.clientUpdatedAtMillis)
        assertNull(forkedActiveMediaAsset.deletedAtMillis)
        assertEquals("workspace-2", forkedTombstonedMediaAsset.workspaceId)
        assertEquals(tombstonedMediaAsset.sha256, forkedTombstonedMediaAsset.sha256)
        assertEquals(tombstonedMediaAsset.deletedAtMillis, forkedTombstonedMediaAsset.deletedAtMillis)
        assertEquals(
            "Front " + managedImageMarkdownReference(
                mediaAssetId = expectedForkedActiveMediaAssetId,
                altText = "Diagram"
            ),
            forkedCard.frontText
        )
        assertEquals(
            "Back " + managedImageMarkdownReference(
                mediaAssetId = expectedForkedTombstonedMediaAssetId,
                altText = "Answer"
            ),
            forkedCard.backText
        )
        assertEquals(expectedForkedCardId, forkedCardPayload.cardId)
        assertEquals(forkedCard.frontText, forkedCardPayload.frontText)
        assertEquals(forkedCard.backText, forkedCardPayload.backText)
    }

    @Test
    fun bootstrapAfterForkQueuesMediaUploadsInsteadOfReplicatingMediaAssets(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val cachedMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = firstContractMediaSha256,
            deletedAtMillis = null
        )
        val uncachedMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-2",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = secondContractMediaSha256,
            deletedAtMillis = null
        )
        database.mediaAssetDao().insertMediaAssets(
            mediaAssets = listOf(cachedMediaAsset, uncachedMediaAsset)
        )
        database.mediaTransferDao().upsertMediaBlobCache(
            mediaBlobCache = MediaBlobCacheEntity(
                sha256 = cachedMediaAsset.sha256,
                mimeType = cachedMediaAsset.mimeType,
                sizeBytes = cachedMediaAsset.sizeBytes,
                localRelativePath = buildMediaBlobCacheRelativePath(sha256 = cachedMediaAsset.sha256),
                createdAtMillis = 1L,
                lastAccessedAtMillis = 1L,
                sourceMediaAssetId = cachedMediaAsset.mediaAssetId
            )
        )
        // The guest already uploaded this image under the source workspace, so the
        // fork carries a succeeded upload onto the forked asset id. That upload says
        // nothing about the destination workspace and must not suppress the new one.
        database.mediaTransferDao().upsertMediaTransfer(
            mediaTransfer = MediaTransferQueueEntity(
                transferId = "transfer-succeeded-1",
                workspaceId = syncLocalStoreContractWorkspaceId,
                mediaAssetId = cachedMediaAsset.mediaAssetId,
                kind = MediaTransferKind.UPLOAD.wireKey,
                status = MediaTransferStatus.SUCCEEDED.wireKey,
                sha256 = cachedMediaAsset.sha256,
                mimeType = cachedMediaAsset.mimeType,
                sizeBytes = cachedMediaAsset.sizeBytes,
                localRelativePath = buildMediaBlobCacheRelativePath(sha256 = cachedMediaAsset.sha256),
                attemptCount = 1,
                nextAttemptAtMillis = 5L,
                lastError = null,
                createdAtMillis = 1L,
                updatedAtMillis = 2L
            )
        )
        database.cardDao().insertCard(
            createContractCardEntity(
                cardId = "card-1",
                workspaceId = syncLocalStoreContractWorkspaceId,
                frontText = "Front " + managedImageMarkdownReference(
                    mediaAssetId = cachedMediaAsset.mediaAssetId,
                    altText = "Diagram"
                ),
                backText = "Back " + managedImageMarkdownReference(
                    mediaAssetId = uncachedMediaAsset.mediaAssetId,
                    altText = "Answer"
                )
            )
        )

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )
        syncLocalStore.prepareReferencedMediaAssetUploads(workspaceId = "workspace-2")

        val expectedForkedCachedMediaAssetId = forkedMediaAssetId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceMediaAssetId = cachedMediaAsset.mediaAssetId
        )
        val bootstrapEntries = syncLocalStore.buildBootstrapEntries(workspaceId = "workspace-2")
        val bootstrapEntityTypes: List<String> = (0 until bootstrapEntries.length()).map { index ->
            bootstrapEntries.getJSONObject(index).getString("entityType")
        }
        val workspaceMediaTransfers = database.mediaTransferDao()
            .loadMediaTransfersForWorkspace(workspaceId = "workspace-2")
        val forkedUploadTransfer = workspaceMediaTransfers.single { mediaTransfer ->
            mediaTransfer.status == MediaTransferStatus.QUEUED.wireKey
        }
        val carriedSucceededTransfer = requireNotNull(
            database.mediaTransferDao().loadMediaTransfer(transferId = "transfer-succeeded-1")
        )

        assertEquals(false, bootstrapEntityTypes.contains("media_asset"))
        assertEquals(listOf("card", "workspace_scheduler_settings"), bootstrapEntityTypes)
        assertEquals(2, workspaceMediaTransfers.size)
        assertEquals(expectedForkedCachedMediaAssetId, forkedUploadTransfer.mediaAssetId)
        assertEquals("workspace-2", forkedUploadTransfer.workspaceId)
        assertEquals(MediaTransferKind.UPLOAD.wireKey, forkedUploadTransfer.kind)
        assertEquals(MediaTransferStatus.QUEUED.wireKey, forkedUploadTransfer.status)
        assertEquals(cachedMediaAsset.sha256, forkedUploadTransfer.sha256)
        assertEquals(
            buildMediaBlobCacheRelativePath(sha256 = cachedMediaAsset.sha256),
            forkedUploadTransfer.localRelativePath
        )
        assertEquals("workspace-2", carriedSucceededTransfer.workspaceId)
        assertEquals(expectedForkedCachedMediaAssetId, carriedSucceededTransfer.mediaAssetId)
        assertEquals(MediaTransferStatus.SUCCEEDED.wireKey, carriedSucceededTransfer.status)
    }

    @Test
    fun forkWorkspaceIdentityCarriesPendingMediaUploadOntoForkedAsset(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val pendingMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = firstContractMediaSha256,
            deletedAtMillis = null
        )
        database.mediaAssetDao().insertMediaAsset(pendingMediaAsset)
        database.mediaTransferDao().upsertMediaTransfer(
            mediaTransfer = MediaTransferQueueEntity(
                transferId = "transfer-1",
                workspaceId = syncLocalStoreContractWorkspaceId,
                mediaAssetId = pendingMediaAsset.mediaAssetId,
                kind = MediaTransferKind.UPLOAD.wireKey,
                status = MediaTransferStatus.QUEUED.wireKey,
                sha256 = pendingMediaAsset.sha256,
                mimeType = pendingMediaAsset.mimeType,
                sizeBytes = pendingMediaAsset.sizeBytes,
                localRelativePath = buildMediaBlobCacheRelativePath(sha256 = pendingMediaAsset.sha256),
                attemptCount = 1,
                nextAttemptAtMillis = 5L,
                lastError = null,
                createdAtMillis = 1L,
                updatedAtMillis = 2L
            )
        )
        database.outboxDao().insertOutboxEntry(
            entry = createMediaAssetOutboxEntry(mediaAsset = pendingMediaAsset)
        )

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = "workspace-2",
                name = "Forked",
                createdAtMillis = 2_000L,
                isSelected = true
            )
        )

        val expectedForkedMediaAssetId = forkedMediaAssetId(
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = "workspace-2",
            sourceMediaAssetId = pendingMediaAsset.mediaAssetId
        )
        val forkedMediaAsset = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = expectedForkedMediaAssetId)
        )
        val forkedTransfer = requireNotNull(
            database.mediaTransferDao().loadMediaTransfer(transferId = "transfer-1")
        )
        val forkedMediaAssetEntry = syncLocalStore.loadOutboxEntries(workspaceId = "workspace-2")
            .single { entry -> entry.operation.entityType == SyncEntityType.MEDIA_ASSET }
        val forkedMediaAssetPayload =
            (forkedMediaAssetEntry.operation.payload as SyncOperationPayload.MediaAsset).payload

        assertEquals("workspace-2", forkedMediaAsset.workspaceId)
        assertEquals(pendingMediaAsset.sha256, forkedMediaAsset.sha256)
        assertEquals("workspace-2", forkedTransfer.workspaceId)
        assertEquals(expectedForkedMediaAssetId, forkedTransfer.mediaAssetId)
        assertEquals(pendingMediaAsset.sha256, forkedTransfer.sha256)
        assertEquals(
            buildMediaBlobCacheRelativePath(sha256 = pendingMediaAsset.sha256),
            forkedTransfer.localRelativePath
        )
        assertEquals(MediaTransferKind.UPLOAD.wireKey, forkedTransfer.kind)
        assertEquals(MediaTransferStatus.QUEUED.wireKey, forkedTransfer.status)
        assertEquals(expectedForkedMediaAssetId, forkedMediaAssetEntry.operation.entityId)
        assertEquals("workspace-2", forkedMediaAssetEntry.workspaceId)
        assertEquals(expectedForkedMediaAssetId, forkedMediaAssetPayload.mediaAssetId)
        assertEquals("workspace-2", forkedMediaAssetPayload.workspaceId)
        assertEquals(pendingMediaAsset.sha256, forkedMediaAssetPayload.sha256)
    }

    @Test
    fun forkWorkspaceIdentityRewritesCurrentLocalShellUsingSourceNamespace(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalMediaAsset = createMediaAssetEntity(
            mediaAssetId = "media-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            sha256 = firstContractMediaSha256,
            deletedAtMillis = null
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            frontText = "Front " + managedImageMarkdownReference(
                mediaAssetId = originalMediaAsset.mediaAssetId,
                altText = "Diagram"
            ),
            backText = "Back",
            cardType = defaultCardType,
            metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(1L)),
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
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
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 3L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z",
            reviewedTimeZone = null
        )
        database.mediaAssetDao().insertMediaAsset(originalMediaAsset)
        database.cardDao().insertCard(originalCard)
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        database.syncStateDao().insertSyncState(
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = 7L,
                lastSuccessfulSyncAtMillis = 8L,
                lastSyncError = "broken",
                blockedInstallationId = null
            )
        )
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId
        )

        val expectedForkedCardId = forkedCardId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceCardId = originalCard.cardId
        )
        val expectedForkedReviewEventId = forkedReviewEventId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceReviewEventId = originalReviewLog.reviewLogId
        )
        val expectedForkedMediaAssetId = forkedMediaAssetId(
            sourceWorkspaceId = "workspace-conflict-source",
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceMediaAssetId = originalMediaAsset.mediaAssetId
        )
        val forkedReviewLog = database.reviewLogDao().loadReviewLogs().single()
        val forkedOutboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)
        val forkedMediaAsset = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = expectedForkedMediaAssetId)
        )
        val forkedCard = requireNotNull(database.cardDao().loadCard(expectedForkedCardId))

        assertEquals(syncLocalStoreContractWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNull(database.cardDao().loadCard(originalCard.cardId))
        assertNull(database.mediaAssetDao().loadMediaAsset(mediaAssetId = originalMediaAsset.mediaAssetId))
        assertEquals(syncLocalStoreContractWorkspaceId, forkedMediaAsset.workspaceId)
        assertEquals(originalMediaAsset.sha256, forkedMediaAsset.sha256)
        assertEquals(
            "Front " + managedImageMarkdownReference(
                mediaAssetId = expectedForkedMediaAssetId,
                altText = "Diagram"
            ),
            forkedCard.frontText
        )
        assertEquals(expectedForkedReviewEventId, forkedReviewLog.reviewLogId)
        assertEquals(expectedForkedCardId, forkedReviewLog.cardId)
        assertEquals(
            setOf(expectedForkedCardId, expectedForkedReviewEventId),
            forkedOutboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
        assertEquals(
            expectedForkedCardId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.CARD }
                .operation.payload as SyncOperationPayload.Card).payload.cardId
        )
        assertEquals(
            expectedForkedReviewEventId,
            (forkedOutboxEntries.first { entry -> entry.operation.entityType == SyncEntityType.REVIEW_EVENT }
                .operation.payload as SyncOperationPayload.ReviewEvent).payload.reviewEventId
        )
        assertEquals(
            SyncStateEntity(
                workspaceId = syncLocalStoreContractWorkspaceId,
                lastSyncCursor = null,
                lastReviewSequenceId = 0L,
                hasHydratedHotState = false,
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = false,
                lastSyncAttemptAtMillis = null,
                lastSuccessfulSyncAtMillis = null,
                lastSyncError = null,
                blockedInstallationId = null
            ),
            database.syncStateDao().loadSyncState(syncLocalStoreContractWorkspaceId)
        )
    }

    @Test
    fun forkWorkspaceIdentityKeepsRowsWhenEffectiveIdsDoNotChange(): Unit = runBlocking {
        insertSyncContractWorkspaceShell(
            database = database,
            workspaceId = syncLocalStoreContractWorkspaceId
        )
        val originalCard = CardEntity(
            cardId = "card-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            frontText = "Front",
            backText = "Back",
            cardType = defaultCardType,
            metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(1L)),
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 2L,
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
        val originalReviewLog = ReviewLogEntity(
            reviewLogId = "review-log-1",
            workspaceId = syncLocalStoreContractWorkspaceId,
            cardId = originalCard.cardId,
            replicaId = "replica-1",
            clientEventId = "client-event-1",
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 3L,
            reviewedAtServerIso = "2026-03-27T19:05:00Z",
            reviewedTimeZone = null
        )
        database.cardDao().insertCard(originalCard)
        database.reviewLogDao().insertReviewLog(originalReviewLog)
        syncLocalStore.enqueueCardUpsert(
            card = originalCard,
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        syncLocalStore.enqueueReviewEventAppend(reviewLog = originalReviewLog)

        syncLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = syncLocalStoreContractWorkspaceId,
            sourceWorkspaceId = syncLocalStoreContractWorkspaceId,
            destinationWorkspaceId = syncLocalStoreContractWorkspaceId
        )

        val reviewLog = database.reviewLogDao().loadReviewLogs().single()
        val outboxEntries = syncLocalStore.loadOutboxEntries(workspaceId = syncLocalStoreContractWorkspaceId)

        assertNotNull(database.cardDao().loadCard(originalCard.cardId))
        assertEquals(1, database.reviewLogDao().countReviewLogs())
        assertEquals(originalReviewLog.reviewLogId, reviewLog.reviewLogId)
        assertEquals(originalCard.cardId, reviewLog.cardId)
        assertEquals(
            setOf(originalCard.cardId, originalReviewLog.reviewLogId),
            outboxEntries.map { entry -> entry.operation.entityId }.toSet()
        )
    }
}

private const val firstContractMediaSha256: String =
    "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
private const val secondContractMediaSha256: String =
    "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"

private fun createContractCardEntity(
    cardId: String,
    workspaceId: String,
    frontText: String,
    backText: String
): CardEntity {
    return CardEntity(
        cardId = cardId,
        workspaceId = workspaceId,
        frontText = frontText,
        backText = backText,
        cardType = defaultCardType,
        metadataJson = encodeDefaultCardMetadataJson(createdAt = formatIsoTimestamp(1L)),
        dueAtMillis = null,
        createdAtMillis = 1L,
        updatedAtMillis = 2L,
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

private fun createMediaAssetEntity(
    mediaAssetId: String,
    workspaceId: String,
    sha256: String,
    deletedAtMillis: Long?
): MediaAssetEntity {
    return MediaAssetEntity(
        mediaAssetId = mediaAssetId,
        workspaceId = workspaceId,
        mimeType = "image/png",
        sizeBytes = 12L,
        sha256 = sha256,
        sourceUrl = null,
        createdAtMillis = 1L,
        clientUpdatedAtMillis = 2L,
        lastModifiedByReplicaId = "replica-1",
        lastOperationId = "operation-1",
        updatedAtMillis = 3L,
        deletedAtMillis = deletedAtMillis
    )
}

private fun createMediaAssetOutboxEntry(mediaAsset: MediaAssetEntity): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = "outbox-media-asset-1",
        workspaceId = mediaAsset.workspaceId,
        installationId = "installation-1",
        entityType = "media_asset",
        entityId = mediaAsset.mediaAssetId,
        operationType = "upsert",
        payloadJson = JSONObject()
            .put("mediaAssetId", mediaAsset.mediaAssetId)
            .put("workspaceId", mediaAsset.workspaceId)
            .put("mimeType", mediaAsset.mimeType)
            .put("sizeBytes", mediaAsset.sizeBytes)
            .put("sha256", mediaAsset.sha256)
            .put("sourceUrl", JSONObject.NULL)
            .put("createdAt", formatIsoTimestamp(mediaAsset.createdAtMillis))
            .put("deletedAt", JSONObject.NULL)
            .toString(),
        clientUpdatedAtIso = formatIsoTimestamp(mediaAsset.clientUpdatedAtMillis),
        createdAtMillis = mediaAsset.createdAtMillis,
        affectsReviewSchedule = false,
        attemptCount = 0,
        lastError = null
    )
}
