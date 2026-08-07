package com.flashcardsopensourceapp.data.local.cloud.sync

import android.util.Log
import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.cloud.wire.buildCardBootstrapEntryJson
import com.flashcardsopensourceapp.data.local.cloud.wire.buildDeckBootstrapEntryJson
import com.flashcardsopensourceapp.data.local.cloud.wire.buildReviewHistoryImportEventJson
import com.flashcardsopensourceapp.data.local.cloud.wire.buildWorkspaceSchedulerSettingsBootstrapEntryJson
import com.flashcardsopensourceapp.data.local.cloud.wire.toCardSummary
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.managedMediaAssetIdsReferencedByCardText
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import java.util.UUID

private const val bootstrapMediaUploadLogTag: String = "FlashcardsBootstrapMedia"

/**
 * Only an upload that has not finished yet makes a new bootstrap upload
 * redundant. A `succeeded` row deliberately does not count: after a workspace
 * fork it describes an upload made under the source workspace and source media
 * asset id, so the destination workspace still has to register the asset.
 * Mirrors the iOS `.pendingOnly` policy in
 * `apps/ios/Flashcards/Flashcards/Database/MediaTransferStore/MediaTransferStore.swift`.
 */
private val pendingUploadMediaTransferStatuses: List<String> = listOf(
    MediaTransferStatus.QUEUED.wireKey,
    MediaTransferStatus.IN_PROGRESS.wireKey
)

internal data class PendingLocalHotEntityKey(
    val entityType: SyncEntityType,
    val entityId: String
)

internal data class BootstrapApplyResult(
    val skippedHotRows: Boolean,
    val appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
)

internal class SyncBootstrapLocalStore(
    private val database: AppDatabase,
    private val outboxLocalStore: SyncOutboxLocalStore,
    private val hotStateLocalStore: SyncHotStateLocalStore,
    private val timeProvider: TimeProvider
) {
    /**
     * Media assets are registered remotely only through the media-assets upload
     * API, and sync replication rejects `media_asset` writes outright, so the
     * bootstrap entries here stay limited to cards, decks and workspace
     * scheduler settings. Mirrors `loadHotBootstrapEntries` in
     * `apps/ios/Flashcards/Flashcards/Database/LocalDatabase/Sync/LocalDatabase+Sync.swift`.
     */
    suspend fun buildBootstrapEntries(workspaceId: String): JSONArray {
        val entries = JSONArray()
        database.cardDao().observeCardsWithRelations().first()
            .map(::toCardSummary)
            .filter { card -> card.workspaceId == workspaceId }
            .forEach { card ->
                entries.put(
                    buildCardBootstrapEntryJson(
                        card = card,
                        lastOperationId = UUID.randomUUID().toString()
                    )
                )
            }

        database.deckDao().observeDecks().first()
            .filter { deck -> deck.workspaceId == workspaceId && deck.deletedAtMillis == null }
            .forEach { deck ->
                entries.put(
                    buildDeckBootstrapEntryJson(
                        deck = deck,
                        lastOperationId = UUID.randomUUID().toString()
                    )
                )
            }

        val settings = database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId = workspaceId)
        if (settings != null) {
            entries.put(
                buildWorkspaceSchedulerSettingsBootstrapEntryJson(
                    workspaceId = workspaceId,
                    settings = settings,
                    lastOperationId = UUID.randomUUID().toString()
                )
            )
        }

        return entries
    }

    /**
     * Queues a media-assets upload for every asset the workspace's active cards
     * still reference, so a workspace bootstrapped into an empty remote — most
     * notably one forked from a guest workspace at sign-in — registers its
     * images through the upload API that the bootstrap entries cannot carry.
     * Mirrors `prepareReferencedMediaAssetUploadsForHotBootstrap` in
     * `apps/ios/Flashcards/Flashcards/Database/LocalDatabase/Sync/LocalDatabase+Sync.swift`.
     */
    suspend fun prepareReferencedMediaAssetUploads(workspaceId: String) {
        val referencedMediaAssetIds: List<String> = database.cardDao().loadCards(workspaceId = workspaceId)
            .filter { card -> card.deletedAtMillis == null }
            .flatMapTo(destination = mutableSetOf()) { card ->
                managedMediaAssetIdsReferencedByCardText(
                    frontText = card.frontText,
                    backText = card.backText
                )
            }
            .sorted()
        if (referencedMediaAssetIds.isEmpty()) {
            return
        }

        database.withTransaction {
            val mediaAssetsById: Map<String, MediaAssetEntity> = database.mediaAssetDao()
                .loadMediaAssets(workspaceId = workspaceId)
                .associateBy { mediaAsset -> mediaAsset.mediaAssetId }
            referencedMediaAssetIds.forEach { mediaAssetId ->
                enqueueReferencedMediaAssetUpload(
                    workspaceId = workspaceId,
                    mediaAssetId = mediaAssetId,
                    mediaAsset = mediaAssetsById[mediaAssetId]
                )
            }
        }
    }

    private suspend fun enqueueReferencedMediaAssetUpload(
        workspaceId: String,
        mediaAssetId: String,
        mediaAsset: MediaAssetEntity?
    ) {
        if (mediaAsset == null || mediaAsset.deletedAtMillis != null) {
            logSkippedReferencedMediaAssetUpload(
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId,
                reason = if (mediaAsset == null) "missingLocalMediaAsset" else "deletedMediaAsset"
            )
            return
        }

        val sha256: String = normalizeMediaSha256(rawSha256 = mediaAsset.sha256)
        val mediaBlobCache: MediaBlobCacheEntity? = database.mediaTransferDao().loadMediaBlobCache(sha256 = sha256)
        if (mediaBlobCache == null) {
            logSkippedReferencedMediaAssetUpload(
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId,
                reason = "missingLocalMediaBlob"
            )
            return
        }
        val hasPendingUpload: Boolean = database.mediaTransferDao().hasMediaTransferForMediaAsset(
            workspaceId = workspaceId,
            mediaAssetId = mediaAssetId,
            sha256 = sha256,
            kind = MediaTransferKind.UPLOAD.wireKey,
            statuses = pendingUploadMediaTransferStatuses
        )
        if (hasPendingUpload) {
            return
        }

        val nowMillis: Long = timeProvider.currentTimeMillis()
        database.mediaTransferDao().upsertMediaTransfer(
            mediaTransfer = MediaTransferQueueEntity(
                transferId = UUID.randomUUID().toString(),
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId,
                kind = MediaTransferKind.UPLOAD.wireKey,
                status = MediaTransferStatus.QUEUED.wireKey,
                sha256 = sha256,
                mimeType = mediaAsset.mimeType,
                sizeBytes = mediaAsset.sizeBytes,
                localRelativePath = mediaBlobCache.localRelativePath,
                attemptCount = 0,
                nextAttemptAtMillis = nowMillis,
                lastError = null,
                createdAtMillis = nowMillis,
                updatedAtMillis = nowMillis
            )
        )
    }

    suspend fun buildReviewHistoryImportEvents(workspaceId: String): JSONArray {
        return JSONArray().apply {
            database.reviewLogDao().loadReviewLogs()
                .filter { reviewLog -> reviewLog.workspaceId == workspaceId }
                .forEach { reviewLog ->
                    put(buildReviewHistoryImportEventJson(reviewLog = reviewLog))
                }
        }
    }

    suspend fun applyBootstrapEntries(workspaceId: String, entries: List<RemoteBootstrapEntry>): BootstrapApplyResult {
        return database.withTransaction {
            val pendingLocalHotEntityKeys: Set<PendingLocalHotEntityKey> =
                outboxLocalStore.loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
            val appliedHotEntityKeys: MutableSet<PendingLocalHotEntityKey> = mutableSetOf()
            var skippedHotRows = false
            entries.forEachIndexed { index, entry ->
                val entryHotEntityKey: PendingLocalHotEntityKey? = entry.toPendingLocalHotEntityKey()
                if (entryHotEntityKey != null && entryHotEntityKey in pendingLocalHotEntityKeys) {
                    // Pending outbox rows are the local source of truth until the push phase drains them.
                    skippedHotRows = true
                    return@forEachIndexed
                }
                hotStateLocalStore.applyHotPayloadInTransaction(
                    workspaceId = workspaceId,
                    entityType = entry.entityType,
                    payload = entry.payload,
                    fieldPath = "bootstrap.entries[$index].payload"
                )
                if (entryHotEntityKey != null) {
                    appliedHotEntityKeys += entryHotEntityKey
                }
            }
            BootstrapApplyResult(
                skippedHotRows = skippedHotRows,
                appliedHotEntityKeys = appliedHotEntityKeys
            )
        }
    }

    suspend fun hasPendingLocalHotRowsForAppliedBootstrapKeys(
        workspaceId: String,
        appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
    ): Boolean {
        if (appliedHotEntityKeys.isEmpty()) {
            return false
        }

        return database.withTransaction {
            outboxLocalStore.loadPendingLocalHotEntityKeysInTransaction(workspaceId = workspaceId)
                .any { pendingHotEntityKey -> pendingHotEntityKey in appliedHotEntityKeys }
        }
    }
}

private fun logSkippedReferencedMediaAssetUpload(
    workspaceId: String,
    mediaAssetId: String,
    reason: String
) {
    Log.w(
        bootstrapMediaUploadLogTag,
        "outcome=skippedReferencedMediaAssetUpload workspaceId=$workspaceId " +
            "mediaAssetId=$mediaAssetId reason=$reason"
    )
}

private fun RemoteBootstrapEntry.toPendingLocalHotEntityKey(): PendingLocalHotEntityKey? {
    return entityType.toPendingLocalHotEntityKey(entityId = entityId)
}

internal fun SyncEntityType.toPendingLocalHotEntityKey(entityId: String): PendingLocalHotEntityKey? {
    return when (this) {
        SyncEntityType.CARD,
        SyncEntityType.DECK,
        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS,
        SyncEntityType.MEDIA_ASSET -> PendingLocalHotEntityKey(
            entityType = this,
            entityId = entityId
        )

        SyncEntityType.REVIEW_EVENT -> null
    }
}
