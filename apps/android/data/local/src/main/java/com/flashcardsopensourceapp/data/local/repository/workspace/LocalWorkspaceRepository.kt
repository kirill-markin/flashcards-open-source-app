package com.flashcardsopensourceapp.data.local.repository.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.cards.LocalSyncDiagnosticsCardMarkdownRow
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.database.media.LocalSyncDiagnosticsMediaAssetIdRow
import com.flashcardsopensourceapp.data.local.database.media.LocalSyncDiagnosticsMediaTransferProblemRow
import com.flashcardsopensourceapp.data.local.database.media.LocalSyncDiagnosticsMissingMediaBlobRow
import com.flashcardsopensourceapp.data.local.database.sync.LocalSyncDiagnosticsOutboxProblemRow
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSyncStatus
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.extractManagedMediaAssetReferences
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsCardOutboxProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsCardsSync
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsManagedMediaSync
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMediaTransferProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMissingMediaBlobProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMissingMediaReferenceProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsProblemRecords
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.cards.isCardDue
import com.flashcardsopensourceapp.data.local.model.cards.isNewCard
import com.flashcardsopensourceapp.data.local.model.cards.isReviewedCard
import com.flashcardsopensourceapp.data.local.model.scheduling.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.scheduling.validateWorkspaceSchedulerSettingsInput
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.cards.toCardSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.observeCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.requireCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runLocalOutboxMutationTransaction
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

private const val localSyncDiagnosticsProblemLimit: Int = 5
private const val cardEntityTypeWireKey: String = "card"
private const val upsertOperationTypeWireKey: String = "upsert"

private data class CardsSyncDiagnosticsObservation(
    val cardsSync: LocalSyncDiagnosticsCardsSync,
    val failedCardOutboxEntries: List<LocalSyncDiagnosticsCardOutboxProblem>
)

private data class ManagedMediaSyncDiagnosticsObservation(
    val managedMediaSync: LocalSyncDiagnosticsManagedMediaSync,
    val failedMediaTransfers: List<LocalSyncDiagnosticsMediaTransferProblem>,
    val missingMediaReferences: List<LocalSyncDiagnosticsMissingMediaReferenceProblem>,
    val assetsMissingLocalBlob: List<LocalSyncDiagnosticsMissingMediaBlobProblem>
)

private data class MediaReferenceDiagnosticsObservation(
    val referencedMediaInCards: Int,
    val referencesMissingLocalAsset: Int,
    val missingMediaReferences: List<LocalSyncDiagnosticsMissingMediaReferenceProblem>,
    val assetsMissingLocalBlob: Int,
    val assetsMissingLocalBlobRows: List<LocalSyncDiagnosticsMissingMediaBlobProblem>
)

@OptIn(ExperimentalCoroutinesApi::class)
class LocalWorkspaceRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncRepository: SyncRepository,
    private val syncLocalStore: SyncLocalStore
) : WorkspaceRepository {
    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).map { workspace ->
            workspace?.let {
                WorkspaceSummary(
                    workspaceId = it.workspaceId,
                    name = it.name,
                    createdAtMillis = it.createdAtMillis
                )
            }
        }
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return combine(
            observeWorkspaceOverview(),
            preferencesStore.observeCloudSettings(),
            syncRepository.observeSyncStatus()
        ) { overview, cloudSettings, syncStatusSnapshot ->
            AppMetadataSummary(
                currentWorkspaceName = overview?.workspaceName,
                workspaceName = overview?.workspaceName,
                deckCount = overview?.deckCount ?: 0,
                cardCount = overview?.totalCards ?: 0,
                localStorage = AppMetadataStorage.ROOM_SQLITE,
                syncStatus = when (cloudSettings.cloudState) {
                    CloudAccountState.DISCONNECTED -> AppMetadataSyncStatus.NotConnected
                    CloudAccountState.LINKING_READY -> AppMetadataSyncStatus.SignInCompleteChooseWorkspace
                    CloudAccountState.GUEST -> AppMetadataSyncStatus.GuestAiSession
                    CloudAccountState.LINKED -> when (val syncStatus: SyncStatus = syncStatusSnapshot.status) {
                        is SyncStatus.Blocked -> {
                            AppMetadataSyncStatus.Message(text = syncStatus.message)
                        }

                        is SyncStatus.Failed -> {
                            AppMetadataSyncStatus.Message(text = syncStatus.message)
                        }

                        SyncStatus.Idle -> AppMetadataSyncStatus.Synced
                        SyncStatus.Syncing -> AppMetadataSyncStatus.Syncing
                    }
                }
            )
        }
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return combine(
            observeCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore
            ),
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations()
        ) { workspace, decks, cards ->
            if (workspace == null) {
                return@combine null
            }

            val cardSummaries: List<CardSummary> = cards.map(::toCardSummary)
            val currentWorkspaceCards: List<CardSummary> = cardSummaries.filter { card ->
                card.workspaceId == workspace.workspaceId && card.deletedAtMillis == null
            }
            val nowMillis: Long = System.currentTimeMillis()
            val tagsSummary: WorkspaceTagsSummary = makeWorkspaceTagsSummary(cards = currentWorkspaceCards)

            WorkspaceOverviewSummary(
                workspaceId = workspace.workspaceId,
                workspaceName = workspace.name,
                totalCards = currentWorkspaceCards.size,
                deckCount = decks.count { deck ->
                    deck.workspaceId == workspace.workspaceId && deck.deletedAtMillis == null
                },
                tagsCount = tagsSummary.tags.size,
                dueCount = currentWorkspaceCards.count { card ->
                    isCardDue(card = card, nowMillis = nowMillis)
                },
                newCount = currentWorkspaceCards.count { card ->
                    isNewCard(card)
                },
                reviewedCount = currentWorkspaceCards.count { card ->
                    isReviewedCard(card)
                }
            )
        }
    }

    override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).flatMapLatest { workspace ->
            if (workspace == null) {
                return@flatMapLatest flowOf(null)
            }

            database.workspaceSchedulerSettingsDao().observeWorkspaceSchedulerSettings(
                workspaceId = workspace.workspaceId
            ).map { settings ->
                settings?.let(::toWorkspaceSchedulerSettings)
                    ?: makeDefaultWorkspaceSchedulerSettings(
                        workspaceId = workspace.workspaceId,
                        updatedAtMillis = workspace.createdAtMillis
                    )
            }
        }
    }

    override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
        return combine(
            observeCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore
            ),
            database.cardDao().observeCardsWithRelations()
        ) { workspace, cards ->
            if (workspace == null) {
                return@combine WorkspaceTagsSummary(tags = emptyList(), totalCards = 0)
            }
            makeWorkspaceTagsSummary(
                cards = cards.map(::toCardSummary).filter { card ->
                    card.workspaceId == workspace.workspaceId
                }
            )
        }
    }

    override fun observeDeviceDiagnostics(): Flow<DeviceDiagnosticsSummary?> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).flatMapLatest { workspace ->
            if (workspace == null) {
                return@flatMapLatest flowOf(null)
            }

            combine(
                flowOf(workspace),
                database.outboxDao().observeOutboxEntriesCount(),
                database.syncStateDao().observeSyncState(workspaceId = workspace.workspaceId)
            ) { currentWorkspace, outboxEntriesCount, syncState ->
                DeviceDiagnosticsSummary(
                    workspaceId = currentWorkspace.workspaceId,
                    workspaceName = currentWorkspace.name,
                    outboxEntriesCount = outboxEntriesCount,
                    lastSyncCursor = syncState?.lastSyncCursor,
                    lastSyncAttemptAtMillis = syncState?.lastSyncAttemptAtMillis,
                    lastSuccessfulSyncAtMillis = syncState?.lastSuccessfulSyncAtMillis,
                    lastSyncErrorMessage = syncState?.lastSyncError
                )
            }
        }
    }

    override fun observeLocalSyncDiagnostics(): Flow<LocalSyncDiagnosticsSummary?> {
        return observeCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore
        ).flatMapLatest { workspace ->
            if (workspace == null) {
                return@flatMapLatest flowOf(null)
            }

            combine(
                observeCardsSyncDiagnostics(workspaceId = workspace.workspaceId),
                observeManagedMediaSyncDiagnostics(workspaceId = workspace.workspaceId)
            ) { cardsObservation, mediaObservation ->
                LocalSyncDiagnosticsSummary(
                    cardsSync = cardsObservation.cardsSync,
                    managedMediaSync = mediaObservation.managedMediaSync,
                    problemRecords = LocalSyncDiagnosticsProblemRecords(
                        failedCardOutboxEntries = cardsObservation.failedCardOutboxEntries,
                        failedMediaTransfers = mediaObservation.failedMediaTransfers,
                        missingMediaReferences = mediaObservation.missingMediaReferences,
                        assetsMissingLocalBlob = mediaObservation.assetsMissingLocalBlob
                    )
                )
            }
        }
    }

    private fun observeCardsSyncDiagnostics(workspaceId: String): Flow<CardsSyncDiagnosticsObservation> {
        return combine(
            preferencesStore.observeCloudSettings(),
            database.syncStateDao().observeSyncState(workspaceId = workspaceId),
            database.cardDao().observeLocalSyncDiagnosticsCardCounts(workspaceId = workspaceId),
            database.outboxDao().observeLocalSyncDiagnosticsOutboxAggregate(
                workspaceId = workspaceId,
                entityType = cardEntityTypeWireKey,
                operationType = upsertOperationTypeWireKey
            ),
            database.outboxDao().observeLocalSyncDiagnosticsOutboxProblemRows(
                workspaceId = workspaceId,
                entityType = cardEntityTypeWireKey,
                operationType = upsertOperationTypeWireKey,
                limit = localSyncDiagnosticsProblemLimit
            )
        ) { cloudSettings, syncState, cardCounts, outboxAggregate, failedOutboxRows ->
            CardsSyncDiagnosticsObservation(
                cardsSync = LocalSyncDiagnosticsCardsSync(
                    workspaceId = workspaceId,
                    installationId = cloudSettings.installationId,
                    cloudState = cloudSettings.cloudState,
                    localActiveCards = cardCounts.localActiveCards,
                    localDeletedCards = cardCounts.localDeletedCards,
                    pendingCardOperations = outboxAggregate.pendingOperationCount,
                    failedCardOperations = outboxAggregate.failedOperationCount,
                    oldestPendingCardOperationAtMillis = outboxAggregate.oldestPendingOperationAtMillis,
                    latestCardSyncSuccessAtMillis = syncState?.lastSuccessfulSyncAtMillis,
                    hotStateHydrated = syncState?.hasHydratedHotState ?: false,
                    hotCursor = syncState?.lastSyncCursor,
                    reviewCursor = syncState?.lastReviewSequenceId,
                    latestSyncError = syncState?.lastSyncError
                ),
                failedCardOutboxEntries = failedOutboxRows.map(::toFailedCardOutboxProblem)
            )
        }
    }

    private fun observeManagedMediaSyncDiagnostics(workspaceId: String): Flow<ManagedMediaSyncDiagnosticsObservation> {
        return combine(
            database.mediaAssetDao().observeLocalSyncDiagnosticsMediaAssetCounts(workspaceId = workspaceId),
            database.mediaTransferDao().observeLocalSyncDiagnosticsMediaBlobAggregate(),
            database.mediaTransferDao().observeLocalSyncDiagnosticsMediaTransferAggregate(
                workspaceId = workspaceId,
                uploadKind = MediaTransferKind.UPLOAD.wireKey,
                queuedStatus = MediaTransferStatus.QUEUED.wireKey,
                inProgressStatus = MediaTransferStatus.IN_PROGRESS.wireKey,
                failedStatus = MediaTransferStatus.FAILED.wireKey,
                succeededStatus = MediaTransferStatus.SUCCEEDED.wireKey
            ),
            database.mediaTransferDao().observeLocalSyncDiagnosticsMediaTransferProblemRows(
                workspaceId = workspaceId,
                kind = MediaTransferKind.UPLOAD.wireKey,
                failedStatus = MediaTransferStatus.FAILED.wireKey,
                limit = localSyncDiagnosticsProblemLimit
            ),
            observeMediaReferenceDiagnostics(workspaceId = workspaceId)
        ) { assetCounts, blobAggregate, transferAggregate, failedTransferRows, referenceDiagnostics ->
            ManagedMediaSyncDiagnosticsObservation(
                managedMediaSync = LocalSyncDiagnosticsManagedMediaSync(
                    localActiveMediaAssets = assetCounts.localActiveMediaAssets,
                    deletedMediaAssets = assetCounts.deletedMediaAssets,
                    localMediaBlobs = blobAggregate.localMediaBlobs,
                    localMediaBytes = blobAggregate.localMediaBytes,
                    referencedMediaInCards = referenceDiagnostics.referencedMediaInCards,
                    referencesMissingLocalAsset = referenceDiagnostics.referencesMissingLocalAsset,
                    assetsMissingLocalBlob = referenceDiagnostics.assetsMissingLocalBlob,
                    pendingMediaUploads = transferAggregate.pendingMediaUploads,
                    failedMediaUploads = transferAggregate.failedMediaUploads,
                    pendingMediaDownloads = null,
                    failedMediaDownloads = null,
                    oldestPendingMediaTransferAtMillis = transferAggregate.oldestPendingMediaTransferAtMillis,
                    latestMediaUploadSuccessAtMillis = transferAggregate.latestMediaUploadSuccessAtMillis,
                    latestMediaDownloadCacheSuccessAtMillis = blobAggregate.latestCacheWriteAtMillis,
                    latestMediaTransferError = transferAggregate.latestMediaTransferError
                ),
                failedMediaTransfers = failedTransferRows.map(::toFailedMediaTransferProblem),
                missingMediaReferences = referenceDiagnostics.missingMediaReferences,
                assetsMissingLocalBlob = referenceDiagnostics.assetsMissingLocalBlobRows
            )
        }
    }

    private fun observeMediaReferenceDiagnostics(workspaceId: String): Flow<MediaReferenceDiagnosticsObservation> {
        return combine(
            database.cardDao().observeLocalSyncDiagnosticsActiveCardMarkdownRows(workspaceId = workspaceId),
            database.mediaAssetDao().observeLocalSyncDiagnosticsActiveMediaAssetIds(workspaceId = workspaceId),
            database.mediaAssetDao().observeLocalSyncDiagnosticsAssetsMissingLocalBlobCount(workspaceId = workspaceId),
            database.mediaAssetDao().observeLocalSyncDiagnosticsMissingMediaBlobRows(
                workspaceId = workspaceId,
                limit = localSyncDiagnosticsProblemLimit
            )
        ) { cardMarkdownRows, activeMediaAssetIdRows, assetsMissingLocalBlob, missingBlobRows ->
            val activeMediaAssetIds: Set<String> = activeMediaAssetIdRows
                .map(LocalSyncDiagnosticsMediaAssetIdRow::mediaAssetId)
                .toSet()
            val referencedMediaAssetIds: Set<String> = cardMarkdownRows
                .flatMap(::extractManagedMediaReferences)
                .toSet()
            val missingMediaReferences: List<LocalSyncDiagnosticsMissingMediaReferenceProblem> =
                makeMissingMediaReferenceProblems(
                    cardMarkdownRows = cardMarkdownRows,
                    activeMediaAssetIds = activeMediaAssetIds
                )

            MediaReferenceDiagnosticsObservation(
                referencedMediaInCards = referencedMediaAssetIds.size,
                referencesMissingLocalAsset = referencedMediaAssetIds.count { mediaAssetId ->
                    activeMediaAssetIds.contains(mediaAssetId).not()
                },
                missingMediaReferences = missingMediaReferences.take(localSyncDiagnosticsProblemLimit),
                assetsMissingLocalBlob = assetsMissingLocalBlob,
                assetsMissingLocalBlobRows = missingBlobRows.map(::toMissingMediaBlobProblem)
            )
        }
    }

    override suspend fun updateWorkspaceSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: List<Int>,
        relearningStepsMinutes: List<Int>,
        maximumIntervalDays: Int,
        enableFuzz: Boolean
    ) {
        val workspace: WorkspaceEntity = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before updating scheduler settings."
        )
        val updatedSettings: WorkspaceSchedulerSettings = validateWorkspaceSchedulerSettingsInput(
            workspaceId = workspace.workspaceId,
            desiredRetention = desiredRetention,
            learningStepsMinutes = learningStepsMinutes,
            relearningStepsMinutes = relearningStepsMinutes,
            maximumIntervalDays = maximumIntervalDays,
            enableFuzz = enableFuzz,
            updatedAtMillis = System.currentTimeMillis()
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val settingsEntity: WorkspaceSchedulerSettingsEntity = toWorkspaceSchedulerSettingsEntity(
                settings = updatedSettings
            )
            database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(settings = settingsEntity)
            syncLocalStore.enqueueWorkspaceSchedulerSettingsUpsert(settings = settingsEntity)
        }
    }
}

private fun extractManagedMediaReferences(row: LocalSyncDiagnosticsCardMarkdownRow): Set<String> {
    return extractManagedMediaAssetReferences(markdown = row.frontText) +
        extractManagedMediaAssetReferences(markdown = row.backText)
}

private fun makeMissingMediaReferenceProblems(
    cardMarkdownRows: List<LocalSyncDiagnosticsCardMarkdownRow>,
    activeMediaAssetIds: Set<String>
): List<LocalSyncDiagnosticsMissingMediaReferenceProblem> {
    return cardMarkdownRows.flatMap { row ->
        extractManagedMediaReferences(row = row)
            .filter { mediaAssetId -> activeMediaAssetIds.contains(mediaAssetId).not() }
            .map { mediaAssetId ->
                LocalSyncDiagnosticsMissingMediaReferenceProblem(
                    cardId = row.cardId,
                    mediaAssetId = mediaAssetId
                )
            }
    }.distinctBy { problem -> problem.cardId to problem.mediaAssetId }
}

private fun toFailedCardOutboxProblem(
    row: LocalSyncDiagnosticsOutboxProblemRow
): LocalSyncDiagnosticsCardOutboxProblem {
    return LocalSyncDiagnosticsCardOutboxProblem(
        operationId = row.outboxEntryId,
        cardId = row.entityId,
        createdAtMillis = row.createdAtMillis,
        attemptCount = row.attemptCount,
        lastError = shortDiagnosticError(error = row.lastError)
    )
}

private fun toFailedMediaTransferProblem(
    row: LocalSyncDiagnosticsMediaTransferProblemRow
): LocalSyncDiagnosticsMediaTransferProblem {
    return LocalSyncDiagnosticsMediaTransferProblem(
        transferId = row.transferId,
        mediaAssetId = row.mediaAssetId,
        kind = row.kind,
        status = row.status,
        createdAtMillis = row.createdAtMillis,
        attemptCount = row.attemptCount,
        lastError = shortDiagnosticError(error = row.lastError)
    )
}

private fun toMissingMediaBlobProblem(
    row: LocalSyncDiagnosticsMissingMediaBlobRow
): LocalSyncDiagnosticsMissingMediaBlobProblem {
    return LocalSyncDiagnosticsMissingMediaBlobProblem(
        mediaAssetId = row.mediaAssetId,
        sha256 = row.sha256
    )
}

private fun shortDiagnosticError(error: String?): String? {
    val normalizedError: String = error
        ?.lineSequence()
        ?.map { line -> line.trim() }
        ?.filter { line -> line.isNotEmpty() }
        ?.joinToString(separator = " ")
        ?.trim()
        ?: return null
    if (normalizedError.isEmpty()) {
        return null
    }
    if (normalizedError.length <= 160) {
        return normalizedError
    }
    return normalizedError.take(n = 157) + "..."
}
