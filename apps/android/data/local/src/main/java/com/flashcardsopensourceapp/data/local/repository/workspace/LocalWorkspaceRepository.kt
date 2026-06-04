package com.flashcardsopensourceapp.data.local.repository.workspace

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSyncStatus
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportCard
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
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
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.observeCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.requireCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runLocalOutboxMutationTransaction
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

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

    override suspend fun loadWorkspaceExportData(): WorkspaceExportData? {
        val workspace: WorkspaceEntity = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return null
        val cards: List<CardSummary> = database.cardDao().observeCardsWithRelations().first().map(::toCardSummary)
        val activeCards: List<CardSummary> = cards.filter { card ->
            card.workspaceId == workspace.workspaceId &&
                card.deletedAtMillis == null
        }

        return WorkspaceExportData(
            workspaceId = workspace.workspaceId,
            workspaceName = workspace.name,
            cards = activeCards.map { card ->
                WorkspaceExportCard(
                    frontText = card.frontText,
                    backText = card.backText,
                    tags = card.tags
                )
            }
        )
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
