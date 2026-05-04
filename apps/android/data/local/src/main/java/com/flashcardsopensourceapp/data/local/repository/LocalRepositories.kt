package com.flashcardsopensourceapp.data.local.repository

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewEffortCountRow
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.ReviewTagCountRow
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.AppMetadataSyncStatus
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportCard
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewDeckFilterOptions
import com.flashcardsopensourceapp.data.local.model.buildReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.computeReviewSchedule
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.encodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.formatCardEffortLabel
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.isNewCard
import com.flashcardsopensourceapp.data.local.model.isReviewedCard
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.makeReviewAnswerOptions
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.matchesReviewFilter
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.queryCards
import com.flashcardsopensourceapp.data.local.model.resolveReviewFilterFromTagNames
import com.flashcardsopensourceapp.data.local.model.toReviewCard
import com.flashcardsopensourceapp.data.local.model.validateWorkspaceSchedulerSettingsInput
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import java.util.UUID

private const val reviewSessionCanonicalQueueSize: Int = 8
private const val reviewSessionQueueLookaheadSize: Int = 1

private sealed interface ReviewTagPredicate {
    data object None : ReviewTagPredicate

    data object Impossible : ReviewTagPredicate

    data class ExactTagNames(
        val tagNames: List<String>
    ) : ReviewTagPredicate {
        init {
            require(tagNames.isNotEmpty()) {
                "Exact review tag predicate must include at least one stored tag name."
            }
        }
    }
}

private data class ReviewQueuePredicate(
    val effortLevels: List<EffortLevel>,
    val tagPredicate: ReviewTagPredicate
)

private data class ReviewSessionQueryBase(
    val workspaceId: String,
    val resolvedFilter: ReviewFilter,
    val predicate: ReviewQueuePredicate,
    val deckEntities: List<DeckEntity>,
    val decksForResolution: List<DeckSummary>,
    val storedTagNames: List<String>,
    val settings: WorkspaceSchedulerSettings,
    val nowMillis: Long
)

private data class ReviewSessionQueueState(
    val canonicalCards: List<CardSummary>,
    val presentedCard: CardSummary?,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean
)

private data class ReviewFilterOptionsState(
    val effortFilters: List<ReviewEffortFilterOption>,
    val tagFilters: List<ReviewTagFilterOption>
)

class LocalCardsRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore
) : CardsRepository {
    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return database.cardDao().observeCardsWithRelations().map { cards ->
            queryCards(
                cards = cards.map(::toCardSummary).filter { card -> card.deletedAtMillis == null },
                searchText = searchQuery,
                filter = filter
            )
        }
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return database.cardDao().observeCardWithRelations(cardId = cardId).map { card ->
            card?.let(::toCardSummary)
        }
    }

    override suspend fun createCard(cardDraft: CardDraft) {
        val workspace = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before creating cards."
        )
        val currentTimeMillis = System.currentTimeMillis()
        val cardId = UUID.randomUUID().toString()
        val card = CardEntity(
            cardId = cardId,
            workspaceId = workspace.workspaceId,
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            dueAtMillis = null,
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis,
            reps = 0,
            lapses = 0,
            fsrsCardState = com.flashcardsopensourceapp.data.local.model.FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null,
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.cardDao().insertCard(card = card)
            replaceCardTags(
                database = database,
                workspaceId = workspace.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = card,
                tags = cardDraft.tags,
                affectsReviewSchedule = true
            )
        }
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft) {
        val currentCard = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot update missing card: $cardId"
        }
        val updatedCard = currentCard.copy(
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.cardDao().updateCard(card = updatedCard)
            replaceCardTags(
                database = database,
                workspaceId = currentCard.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = updatedCard,
                tags = cardDraft.tags,
                affectsReviewSchedule = currentCard.deletedAtMillis != null
            )
        }
    }

    override suspend fun deleteCard(cardId: String) {
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot delete missing card: $cardId"
        }

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val deletedCard = card.copy(
                updatedAtMillis = System.currentTimeMillis(),
                deletedAtMillis = System.currentTimeMillis()
            )
            val cardTags = database.cardDao().observeCardWithRelations(cardId = cardId).first()?.tags?.map(TagEntity::name) ?: emptyList()
            database.cardDao().updateCard(card = deletedCard)
            syncLocalStore.enqueueCardUpsert(
                card = deletedCard,
                tags = cardTags,
                affectsReviewSchedule = true
            )
        }
    }
}

class LocalDecksRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore
) : DecksRepository {
    override fun observeDecks(): Flow<List<DeckSummary>> {
        return combine(
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations()
        ) { decks, cards ->
            val cardSummaries = cards.map(::toCardSummary)
            val nowMillis = System.currentTimeMillis()

            decks.filter { deck -> deck.deletedAtMillis == null }.map { deck ->
                toDeckSummary(
                    deck = deck,
                    cards = cardSummaries.filter { card -> card.deletedAtMillis == null },
                    nowMillis = nowMillis
                )
            }
        }
    }

    override fun observeDeck(deckId: String): Flow<DeckSummary?> {
        return observeDecks().map { decks ->
            decks.firstOrNull { deck ->
                deck.deckId == deckId
            }
        }
    }

    override fun observeDeckCards(deckId: String): Flow<List<CardSummary>> {
        return combine(
            database.deckDao().observeDeck(deckId = deckId),
            database.cardDao().observeCardsWithRelations()
        ) { deck, cards ->
            if (deck == null) {
                return@combine emptyList()
            }

            val filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson)
            cards.map(::toCardSummary).filter { card ->
                card.deletedAtMillis == null &&
                matchesDeckFilterDefinition(
                    filterDefinition = filterDefinition,
                    card = card
                )
            }
        }
    }

    override suspend fun createDeck(deckDraft: DeckDraft) {
        val workspace = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before creating decks."
        )
        val normalizedDeckDraft = normalizeDeckDraft(deckDraft = deckDraft)
        val currentTimeMillis = System.currentTimeMillis()
        val deck = DeckEntity(
            deckId = UUID.randomUUID().toString(),
            workspaceId = workspace.workspaceId,
            name = normalizedDeckDraft.name,
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = normalizedDeckDraft.filterDefinition
            ),
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis,
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().insertDeck(deck = deck)
            syncLocalStore.enqueueDeckUpsert(deck)
        }
    }

    override suspend fun updateDeck(deckId: String, deckDraft: DeckDraft) {
        val currentDeck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot update missing deck: $deckId"
        }
        val normalizedDeckDraft = normalizeDeckDraft(deckDraft = deckDraft)
        val updatedDeck = currentDeck.copy(
            name = normalizedDeckDraft.name,
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = normalizedDeckDraft.filterDefinition
            ),
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().updateDeck(deck = updatedDeck)
            syncLocalStore.enqueueDeckUpsert(updatedDeck)
        }
    }

    override suspend fun deleteDeck(deckId: String) {
        val existingDeck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot delete missing deck: $deckId"
        }

        val deletedDeck = existingDeck.copy(
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = System.currentTimeMillis()
        )
        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().updateDeck(deck = deletedDeck)
            syncLocalStore.enqueueDeckUpsert(deletedDeck)
        }
    }
}

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
                    CloudAccountState.LINKED -> when (val syncStatus = syncStatusSnapshot.status) {
                        is com.flashcardsopensourceapp.data.local.model.SyncStatus.Blocked -> {
                            AppMetadataSyncStatus.Message(text = syncStatus.message)
                        }

                        is com.flashcardsopensourceapp.data.local.model.SyncStatus.Failed -> {
                            AppMetadataSyncStatus.Message(text = syncStatus.message)
                        }

                        com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle -> AppMetadataSyncStatus.Synced
                        com.flashcardsopensourceapp.data.local.model.SyncStatus.Syncing -> AppMetadataSyncStatus.Syncing
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

            val cardSummaries = cards.map(::toCardSummary)
            val currentWorkspaceCards = cardSummaries.filter { card ->
                card.workspaceId == workspace.workspaceId && card.deletedAtMillis == null
            }
            val nowMillis = System.currentTimeMillis()
            val tagsSummary = makeWorkspaceTagsSummary(cards = currentWorkspaceCards)

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
        val workspace = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return null
        val cards = database.cardDao().observeCardsWithRelations().first().map(::toCardSummary)
        val activeCards = cards.filter { card ->
            card.workspaceId == workspace.workspaceId
                && card.deletedAtMillis == null
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
        val workspace = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before updating scheduler settings."
        )
        val updatedSettings = validateWorkspaceSchedulerSettingsInput(
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
            val settingsEntity = toWorkspaceSchedulerSettingsEntity(settings = updatedSettings)
            database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(settings = settingsEntity)
            syncLocalStore.enqueueWorkspaceSchedulerSettingsUpsert(settings = settingsEntity)
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class LocalReviewRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore,
    private val localProgressCacheStore: LocalProgressCacheStore
) : ReviewRepository {
    override fun observeReviewSession(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<com.flashcardsopensourceapp.data.local.model.PendingReviewedCard>,
        presentedCardId: String?
    ): Flow<ReviewSessionSnapshot> {
        return combine(
            observeCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore
            ),
            database.deckDao().observeDecks()
        ) { workspace, decks ->
            workspace to decks
        }.flatMapLatest { (workspace, decks) ->
            if (workspace == null) {
                return@flatMapLatest flowOf(
                    makeEmptyReviewSessionSnapshot(
                        nowMillis = System.currentTimeMillis()
                    )
                )
            }

            val workspaceId = workspace.workspaceId
            val activeDeckEntities = decks.filter { deck ->
                deck.workspaceId == workspaceId && deck.deletedAtMillis == null
            }

            combine(
                database.tagDao().observeReviewTagNames(workspaceId = workspaceId),
                database.workspaceSchedulerSettingsDao().observeWorkspaceSchedulerSettings(
                    workspaceId = workspaceId
                ),
                database.cardDao().observeCardCount()
            ) { storedTagNames, settingsEntity, _ ->
                val nowMillis = System.currentTimeMillis()
                val decksForResolution = activeDeckEntities.map { deck ->
                    toReviewDeckSummary(
                        deck = deck,
                        dueCards = 0
                    )
                }
                val resolvedFilter = resolveReviewFilterFromTagNames(
                    selectedFilter = selectedFilter,
                    decks = decksForResolution,
                    tagNames = storedTagNames
                )
                val settings = settingsEntity?.let(::toWorkspaceSchedulerSettings)
                    ?: makeDefaultWorkspaceSchedulerSettings(
                        workspaceId = workspaceId,
                        updatedAtMillis = nowMillis
                    )

                ReviewSessionQueryBase(
                    workspaceId = workspaceId,
                    resolvedFilter = resolvedFilter,
                    predicate = makeReviewQueuePredicate(
                        selectedFilter = resolvedFilter,
                        decks = decksForResolution,
                        storedTagNames = storedTagNames
                    ),
                    deckEntities = activeDeckEntities,
                    decksForResolution = decksForResolution,
                    storedTagNames = storedTagNames,
                    settings = settings,
                    nowMillis = nowMillis
                )
            }.flatMapLatest { queryBase ->
                val queueLoadLimit = reviewSessionCanonicalQueueSize +
                    pendingReviewedCards.size +
                    reviewSessionQueueLookaheadSize
                val queueStateFlow = combine(
                    observeActiveReviewQueue(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        nowMillis = queryBase.nowMillis,
                        predicate = queryBase.predicate,
                        limit = queueLoadLimit
                    ),
                    observeReviewDueCount(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        nowMillis = queryBase.nowMillis,
                        predicate = queryBase.predicate
                    ),
                    observeReviewTotalCount(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        predicate = queryBase.predicate
                    ),
                    observePresentedCard(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        presentedCardId = presentedCardId
                    ),
                    observePendingReviewedCards(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        pendingReviewedCards = pendingReviewedCards
                    )
                ) { queueCards, dueCount, totalCount, presentedCard, pendingCards ->
                    val canonicalCandidates = queueCards.map(::toCardSummary).filter { card ->
                        matchesPendingReviewedCard(
                            pendingReviewedCards = pendingReviewedCards,
                            card = card
                        ).not()
                    }
                    val canonicalCards = canonicalCandidates.take(reviewSessionCanonicalQueueSize)
                    val pendingMatchingCount = pendingCards.map(::toCardSummary).count { card ->
                        isPendingReviewCardCounted(
                            card = card,
                            pendingReviewedCards = pendingReviewedCards,
                            selectedFilter = queryBase.resolvedFilter,
                            decks = queryBase.decksForResolution,
                            nowMillis = queryBase.nowMillis
                        )
                    }

                    ReviewSessionQueueState(
                        canonicalCards = canonicalCards,
                        presentedCard = resolvePresentedCardSummary(
                            canonicalCards = canonicalCards,
                            loadedPresentedCard = presentedCard?.let(::toCardSummary),
                            presentedCardId = presentedCardId,
                            pendingReviewedCards = pendingReviewedCards,
                            selectedFilter = queryBase.resolvedFilter,
                            decks = queryBase.decksForResolution,
                            nowMillis = queryBase.nowMillis
                        ),
                        dueCount = dueCount,
                        remainingCount = maxOf(0, dueCount - pendingMatchingCount),
                        totalCount = totalCount,
                        hasMoreCards = canonicalCandidates.size > reviewSessionCanonicalQueueSize ||
                            queueCards.size == queueLoadLimit
                    )
                }
                val filterOptionsFlow = combine(
                    database.cardDao().observeReviewEffortDueCounts(
                        workspaceId = queryBase.workspaceId,
                        nowMillis = queryBase.nowMillis
                    ),
                    database.cardDao().observeReviewTagDueCounts(
                        workspaceId = queryBase.workspaceId,
                        nowMillis = queryBase.nowMillis
                    )
                ) { effortCountRows, tagCountRows ->
                    ReviewFilterOptionsState(
                        effortFilters = buildReviewEffortFilterOptionsFromRows(rows = effortCountRows),
                        tagFilters = buildReviewTagFilterOptionsFromRows(rows = tagCountRows)
                    )
                }

                combine(queueStateFlow, filterOptionsFlow) { queueState, filterOptions ->
                    val deckSummaries = loadReviewDeckSummaries(
                        database = database,
                        workspaceId = queryBase.workspaceId,
                        deckEntities = queryBase.deckEntities,
                        storedTagNames = queryBase.storedTagNames,
                        nowMillis = queryBase.nowMillis
                    )

                    buildBoundedReviewSessionSnapshot(
                        selectedFilter = queryBase.resolvedFilter,
                        decks = deckSummaries,
                        canonicalCards = queueState.canonicalCards,
                        presentedCard = queueState.presentedCard,
                        dueCount = queueState.dueCount,
                        remainingCount = queueState.remainingCount,
                        totalCount = queueState.totalCount,
                        hasMoreCards = queueState.hasMoreCards,
                        availableDeckFilters = buildReviewDeckFilterOptions(decks = deckSummaries),
                        availableEffortFilters = filterOptions.effortFilters,
                        availableTagFilters = filterOptions.tagFilters,
                        settings = queryBase.settings,
                        reviewedAtMillis = queryBase.nowMillis
                    )
                }
            }
        }
    }

    override suspend fun loadReviewTimelinePage(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<com.flashcardsopensourceapp.data.local.model.PendingReviewedCard>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage {
        val currentWorkspaceId: String? = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
        val nowMillis: Long = System.currentTimeMillis()
        val cards = database.cardDao().observeCardsWithRelations().first()
        val decks = database.deckDao().observeDecks().first()
        val cardSummaries = cards.map(::toCardSummary).filter { card ->
            card.deletedAtMillis == null && (currentWorkspaceId == null || card.workspaceId == currentWorkspaceId)
        }
        val deckSummaries = decks.filter { deck ->
            deck.deletedAtMillis == null && (currentWorkspaceId == null || deck.workspaceId == currentWorkspaceId)
        }.map { deck ->
            toDeckSummary(
                deck = deck,
                cards = cardSummaries,
                nowMillis = nowMillis
            )
        }
        val tagsSummary: WorkspaceTagsSummary = if (currentWorkspaceId == null) {
            makeWorkspaceTagsSummary(cards = cardSummaries)
        } else {
            makeWorkspaceTagsSummaryFromStoredTagNames(
                tagNames = database.tagDao().loadReviewTagNames(workspaceId = currentWorkspaceId),
                totalCards = cardSummaries.size
            )
        }

        return buildReviewTimelinePage(
            selectedFilter = selectedFilter,
            pendingReviewedCards = pendingReviewedCards,
            decks = deckSummaries,
            cards = cardSummaries,
            tagsSummary = tagsSummary,
            reviewedAtMillis = nowMillis,
            offset = offset,
            limit = limit
        )
    }

    override suspend fun countRecordedReviews(): Int {
        return database.reviewLogDao().countReviewLogs()
    }

    override suspend fun loadReviewCardForRollback(selectedFilter: ReviewFilter, cardId: String): ReviewCard? {
        val workspace = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return null
        val nowMillis = System.currentTimeMillis()
        val card = database.cardDao().observeCardWithRelationsByWorkspace(
            cardId = cardId,
            workspaceId = workspace.workspaceId
        ).first() ?: return null
        val cardSummary = toCardSummary(card = card)
        if (cardSummary.deletedAtMillis != null) {
            return null
        }
        if (isCardDue(card = cardSummary, nowMillis = nowMillis).not()) {
            return null
        }

        val activeDeckEntities = database.deckDao().observeDecks().first().filter { deck ->
            deck.workspaceId == workspace.workspaceId && deck.deletedAtMillis == null
        }
        val storedTagNames = database.tagDao().loadReviewTagNames(workspaceId = workspace.workspaceId)
        val decksForResolution = activeDeckEntities.map { deck ->
            toReviewDeckSummary(
                deck = deck,
                dueCards = 0
            )
        }
        val resolvedFilter = resolveReviewFilterFromTagNames(
            selectedFilter = selectedFilter,
            decks = decksForResolution,
            tagNames = storedTagNames
        )
        if (resolvedFilter != selectedFilter) {
            return null
        }
        if (matchesReviewFilter(
                filter = resolvedFilter,
                decks = decksForResolution,
                card = cardSummary
            ).not()
        ) {
            return null
        }

        return toReviewCard(
            card = cardSummary,
            queueStatus = ReviewCardQueueStatus.ACTIVE
        )
    }

    override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
                "Cannot review missing card: $cardId"
            }
            val schedulerSettingsEntity = requireNotNull(
                database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
                    workspaceId = card.workspaceId
                )
            ) {
                "Scheduler settings are required before reviewing card: $cardId"
            }
            val cardWithRelations = requireNotNull(
                database.cardDao().observeCardWithRelations(cardId = cardId).first()
            ) {
                "Cannot load review card relations for card: $cardId"
            }
            val cardSummary = toCardSummary(cardWithRelations)
            val schedule = computeReviewSchedule(
                card = cardSummary,
                settings = toWorkspaceSchedulerSettings(schedulerSettingsEntity),
                rating = rating,
                reviewedAtMillis = reviewedAtMillis
            )

            database.cardDao().updateCard(
                card = card.copy(
                    dueAtMillis = schedule.dueAtMillis,
                    updatedAtMillis = reviewedAtMillis,
                    reps = schedule.reps,
                    lapses = schedule.lapses,
                    fsrsCardState = schedule.fsrsCardState,
                    fsrsStepIndex = schedule.fsrsStepIndex,
                    fsrsStability = schedule.fsrsStability,
                    fsrsDifficulty = schedule.fsrsDifficulty,
                    fsrsLastReviewedAtMillis = schedule.fsrsLastReviewedAtMillis,
                    fsrsScheduledDays = schedule.fsrsScheduledDays
                )
            )
            val reviewLog = ReviewLogEntity(
                reviewLogId = UUID.randomUUID().toString(),
                workspaceId = card.workspaceId,
                cardId = cardId,
                replicaId = preferencesStore.currentCloudSettings().installationId,
                clientEventId = UUID.randomUUID().toString(),
                rating = rating,
                reviewedAtMillis = reviewedAtMillis,
                reviewedAtServerIso = formatIsoTimestamp(reviewedAtMillis)
            )
            database.reviewLogDao().insertReviewLog(reviewLog = reviewLog)
            localProgressCacheStore.recordReviewInTransaction(
                reviewLog = reviewLog,
                updatedAtMillis = reviewedAtMillis
            )
            syncLocalStore.enqueueReviewEventAppend(reviewLog)
            syncLocalStore.enqueueCardUpsert(
                card = card.copy(
                    dueAtMillis = schedule.dueAtMillis,
                    updatedAtMillis = reviewedAtMillis,
                    reps = schedule.reps,
                    lapses = schedule.lapses,
                    fsrsCardState = schedule.fsrsCardState,
                    fsrsStepIndex = schedule.fsrsStepIndex,
                    fsrsStability = schedule.fsrsStability,
                    fsrsDifficulty = schedule.fsrsDifficulty,
                    fsrsLastReviewedAtMillis = schedule.fsrsLastReviewedAtMillis,
                    fsrsScheduledDays = schedule.fsrsScheduledDays
                ),
                tags = cardSummary.tags,
                affectsReviewSchedule = true
            )
        }
    }
}

private fun makeEmptyReviewSessionSnapshot(nowMillis: Long): ReviewSessionSnapshot {
    return buildBoundedReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        decks = emptyList(),
        canonicalCards = emptyList(),
        presentedCard = null,
        dueCount = 0,
        remainingCount = 0,
        totalCount = 0,
        hasMoreCards = false,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "",
            updatedAtMillis = nowMillis
        ),
        reviewedAtMillis = nowMillis
    )
}

private fun makeReviewQueuePredicate(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    storedTagNames: List<String>
): ReviewQueuePredicate {
    return when (selectedFilter) {
        ReviewFilter.AllCards -> ReviewQueuePredicate(
            effortLevels = emptyList(),
            tagPredicate = ReviewTagPredicate.None
        )

        is ReviewFilter.Deck -> {
            val deck = requireNotNull(decks.firstOrNull { deck ->
                deck.deckId == selectedFilter.deckId
            }) {
                "Cannot build review queue predicate for missing deck: ${selectedFilter.deckId}"
            }
            makeReviewQueuePredicate(
                filterDefinition = deck.filterDefinition,
                storedTagNames = storedTagNames
            )
        }

        is ReviewFilter.Effort -> ReviewQueuePredicate(
            effortLevels = listOf(selectedFilter.effortLevel),
            tagPredicate = ReviewTagPredicate.None
        )

        is ReviewFilter.Tag -> ReviewQueuePredicate(
            effortLevels = emptyList(),
            tagPredicate = makeReviewTagPredicate(
                requestedTagNames = listOf(selectedFilter.tag),
                storedTagNames = storedTagNames
            )
        )
    }
}

private fun makeReviewQueuePredicate(
    filterDefinition: DeckFilterDefinition,
    storedTagNames: List<String>
): ReviewQueuePredicate {
    return ReviewQueuePredicate(
        effortLevels = filterDefinition.effortLevels.distinct(),
        tagPredicate = makeReviewTagPredicate(
            requestedTagNames = filterDefinition.tags,
            storedTagNames = storedTagNames
        )
    )
}

private fun makeReviewTagPredicate(
    requestedTagNames: List<String>,
    storedTagNames: List<String>
): ReviewTagPredicate {
    val requestedTagKeys: List<String> = requestedTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.filter { tagKey ->
        tagKey.isNotEmpty()
    }.distinct()
    if (requestedTagKeys.isEmpty()) {
        return ReviewTagPredicate.None
    }

    val requestedTagKeySet: Set<String> = requestedTagKeys.toSet()
    val exactTagNames: List<String> = storedTagNames.filter { storedTagName ->
        requestedTagKeySet.contains(normalizeTagKey(tag = storedTagName))
    }.distinct()

    return if (exactTagNames.isEmpty()) {
        ReviewTagPredicate.Impossible
    } else {
        ReviewTagPredicate.ExactTagNames(tagNames = exactTagNames)
    }
}

private fun observeActiveReviewQueue(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate,
    limit: Int
): Flow<List<CardWithRelations>> {
    require(limit > 0) {
        "Review queue load limit must be positive."
    }

    return when (val tagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.Impossible -> flowOf(emptyList<CardWithRelations>())
        ReviewTagPredicate.None -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeActiveReviewQueue(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    limit = limit
                )
            } else {
                database.cardDao().observeActiveReviewQueueByEffortLevels(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels,
                    limit = limit
                )
            }
        }

        is ReviewTagPredicate.ExactTagNames -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeActiveReviewQueueByAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    tagNames = tagPredicate.tagNames,
                    limit = limit
                )
            } else {
                database.cardDao().observeActiveReviewQueueByEffortLevelsAndAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels,
                    tagNames = tagPredicate.tagNames,
                    limit = limit
                )
            }
        }
    }
}

private fun observeReviewDueCount(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return when (val tagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.Impossible -> flowOf(0)
        ReviewTagPredicate.None -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeReviewDueCount(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis
                )
            } else {
                database.cardDao().observeReviewDueCountByEffortLevels(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels
                )
            }
        }

        is ReviewTagPredicate.ExactTagNames -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeReviewDueCountByAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    tagNames = tagPredicate.tagNames
                )
            } else {
                database.cardDao().observeReviewDueCountByEffortLevelsAndAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels,
                    tagNames = tagPredicate.tagNames
                )
            }
        }
    }
}

private fun observeReviewTotalCount(
    database: AppDatabase,
    workspaceId: String,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return when (val tagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.Impossible -> flowOf(0)
        ReviewTagPredicate.None -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeReviewTotalCount(workspaceId = workspaceId)
            } else {
                database.cardDao().observeReviewTotalCountByEffortLevels(
                    workspaceId = workspaceId,
                    effortLevels = predicate.effortLevels
                )
            }
        }

        is ReviewTagPredicate.ExactTagNames -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().observeReviewTotalCountByAnyTags(
                    workspaceId = workspaceId,
                    tagNames = tagPredicate.tagNames
                )
            } else {
                database.cardDao().observeReviewTotalCountByEffortLevelsAndAnyTags(
                    workspaceId = workspaceId,
                    effortLevels = predicate.effortLevels,
                    tagNames = tagPredicate.tagNames
                )
            }
        }
    }
}

private fun observePresentedCard(
    database: AppDatabase,
    workspaceId: String,
    presentedCardId: String?
): Flow<CardWithRelations?> {
    return if (presentedCardId == null) {
        flowOf(null)
    } else {
        database.cardDao().observeCardWithRelationsByWorkspace(
            cardId = presentedCardId,
            workspaceId = workspaceId
        )
    }
}

private fun observePendingReviewedCards(
    database: AppDatabase,
    workspaceId: String,
    pendingReviewedCards: Set<PendingReviewedCard>
): Flow<List<CardWithRelations>> {
    val cardIds = pendingReviewedCards.map { pendingReviewedCard ->
        pendingReviewedCard.cardId
    }.distinct()

    return if (cardIds.isEmpty()) {
        flowOf(emptyList())
    } else {
        database.cardDao().observeCardsWithRelationsByWorkspaceAndIds(
            workspaceId = workspaceId,
            cardIds = cardIds
        )
    }
}

private fun isPendingReviewCardCounted(
    card: CardSummary,
    pendingReviewedCards: Set<PendingReviewedCard>,
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    nowMillis: Long
): Boolean {
    if (matchesPendingReviewedCard(pendingReviewedCards = pendingReviewedCards, card = card).not()) {
        return false
    }
    if (card.deletedAtMillis != null) {
        return false
    }
    if (isCardDue(card = card, nowMillis = nowMillis).not()) {
        return false
    }

    return matchesReviewFilter(
        filter = selectedFilter,
        decks = decks,
        card = card
    )
}

private fun resolvePresentedCardSummary(
    canonicalCards: List<CardSummary>,
    loadedPresentedCard: CardSummary?,
    presentedCardId: String?,
    pendingReviewedCards: Set<PendingReviewedCard>,
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    nowMillis: Long
): CardSummary? {
    if (presentedCardId == null) {
        return canonicalCards.firstOrNull()
    }

    val canonicalPresentedCard = canonicalCards.firstOrNull { card ->
        card.cardId == presentedCardId
    }
    if (canonicalPresentedCard != null) {
        return canonicalPresentedCard
    }

    val candidate = loadedPresentedCard ?: return canonicalCards.firstOrNull()
    if (isPreservablePresentedCard(
            card = candidate,
            pendingReviewedCards = pendingReviewedCards,
            selectedFilter = selectedFilter,
            decks = decks,
            nowMillis = nowMillis
        )
    ) {
        return candidate
    }

    return canonicalCards.firstOrNull()
}

private fun isPreservablePresentedCard(
    card: CardSummary,
    pendingReviewedCards: Set<PendingReviewedCard>,
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    nowMillis: Long
): Boolean {
    if (matchesPendingReviewedCard(pendingReviewedCards = pendingReviewedCards, card = card)) {
        return false
    }
    if (card.deletedAtMillis != null) {
        return false
    }
    if (isCardDue(card = card, nowMillis = nowMillis).not()) {
        return false
    }

    return matchesReviewFilter(
        filter = selectedFilter,
        decks = decks,
        card = card
    )
}

private fun buildReviewEffortFilterOptionsFromRows(
    rows: List<ReviewEffortCountRow>
): List<ReviewEffortFilterOption> {
    val countsByEffort = rows.associate { row ->
        row.effortLevel to row.totalCount
    }

    return EffortLevel.entries.map { effortLevel ->
        ReviewEffortFilterOption(
            effortLevel = effortLevel,
            title = formatCardEffortLabel(effortLevel = effortLevel),
            totalCount = countsByEffort[effortLevel] ?: 0
        )
    }
}

private fun buildReviewTagFilterOptionsFromRows(rows: List<ReviewTagCountRow>): List<ReviewTagFilterOption> {
    return rows.map { row ->
        ReviewTagFilterOption(
            tag = row.tag,
            totalCount = row.totalCount
        )
    }.sortedWith(
        compareBy<ReviewTagFilterOption> { option ->
            option.tag.lowercase()
        }.thenBy { option ->
            option.tag
        }
    )
}

private suspend fun loadReviewDeckSummaries(
    database: AppDatabase,
    workspaceId: String,
    deckEntities: List<DeckEntity>,
    storedTagNames: List<String>,
    nowMillis: Long
): List<DeckSummary> {
    // Run per-deck due-count queries in parallel to avoid N+1 sequential
    // round-trips when many decks are present.
    return coroutineScope {
        deckEntities.map { deck ->
            async {
                val filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson)
                val dueCards = countReviewDueCards(
                    database = database,
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    predicate = makeReviewQueuePredicate(
                        filterDefinition = filterDefinition,
                        storedTagNames = storedTagNames
                    )
                )

                toReviewDeckSummary(
                    deck = deck,
                    dueCards = dueCards
                )
            }
        }.awaitAll()
    }
}

private suspend fun countReviewDueCards(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate
): Int {
    return when (val tagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.Impossible -> 0
        ReviewTagPredicate.None -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().countReviewDueCards(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis
                )
            } else {
                database.cardDao().countReviewDueCardsByEffortLevels(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels
                )
            }
        }

        is ReviewTagPredicate.ExactTagNames -> {
            if (predicate.effortLevels.isEmpty()) {
                database.cardDao().countReviewDueCardsByAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    tagNames = tagPredicate.tagNames
                )
            } else {
                database.cardDao().countReviewDueCardsByEffortLevelsAndAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = predicate.effortLevels,
                    tagNames = tagPredicate.tagNames
                )
            }
        }
    }
}

private fun toReviewDeckSummary(deck: DeckEntity, dueCards: Int): DeckSummary {
    return DeckSummary(
        deckId = deck.deckId,
        workspaceId = deck.workspaceId,
        name = deck.name,
        filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson),
        totalCards = dueCards,
        dueCards = dueCards,
        newCards = 0,
        reviewedCards = 0,
        createdAtMillis = deck.createdAtMillis,
        updatedAtMillis = deck.updatedAtMillis
    )
}

private fun matchesPendingReviewedCard(
    pendingReviewedCards: Set<PendingReviewedCard>,
    card: CardSummary
): Boolean {
    return pendingReviewedCards.contains(
        PendingReviewedCard(
            cardId = card.cardId,
            updatedAtMillis = card.updatedAtMillis
        )
    )
}

private fun toCardSummary(card: CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = normalizeTags(
            values = card.tags.map { tag -> tag.name },
            referenceTags = emptyList()
        ),
        effortLevel = card.card.effortLevel,
        dueAtMillis = card.card.dueAtMillis,
        createdAtMillis = card.card.createdAtMillis,
        updatedAtMillis = card.card.updatedAtMillis,
        reps = card.card.reps,
        lapses = card.card.lapses,
        fsrsCardState = card.card.fsrsCardState,
        fsrsStepIndex = card.card.fsrsStepIndex,
        fsrsStability = card.card.fsrsStability,
        fsrsDifficulty = card.card.fsrsDifficulty,
        fsrsLastReviewedAtMillis = card.card.fsrsLastReviewedAtMillis,
        fsrsScheduledDays = card.card.fsrsScheduledDays,
        deletedAtMillis = card.card.deletedAtMillis
    )
}

private suspend fun <Result> runLocalOutboxMutationTransaction(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    block: suspend () -> Result
): Result {
    return preferencesStore.runWithLocalOutboxMutationAllowed {
        database.withTransaction {
            block()
        }
    }
}

private fun toWorkspaceSchedulerSettingsEntity(settings: WorkspaceSchedulerSettings): WorkspaceSchedulerSettingsEntity {
    return WorkspaceSchedulerSettingsEntity(
        workspaceId = settings.workspaceId,
        algorithm = settings.algorithm,
        desiredRetention = settings.desiredRetention,
        learningStepsMinutesJson = encodeSchedulerStepListJson(values = settings.learningStepsMinutes),
        relearningStepsMinutesJson = encodeSchedulerStepListJson(values = settings.relearningStepsMinutes),
        maximumIntervalDays = settings.maximumIntervalDays,
        enableFuzz = settings.enableFuzz,
        updatedAtMillis = settings.updatedAtMillis
    )
}

private fun toWorkspaceSchedulerSettings(entity: WorkspaceSchedulerSettingsEntity): WorkspaceSchedulerSettings {
    return validateWorkspaceSchedulerSettingsInput(
        workspaceId = entity.workspaceId,
        desiredRetention = entity.desiredRetention,
        learningStepsMinutes = decodeSchedulerStepListJson(json = entity.learningStepsMinutesJson),
        relearningStepsMinutes = decodeSchedulerStepListJson(json = entity.relearningStepsMinutesJson),
        maximumIntervalDays = entity.maximumIntervalDays,
        enableFuzz = entity.enableFuzz,
        updatedAtMillis = entity.updatedAtMillis
    )
}

private suspend fun replaceCardTags(
    database: AppDatabase,
    workspaceId: String,
    cardId: String,
    tags: List<String>
) {
    val workspaceTags = database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId)
    val normalizedTags = normalizeTags(
        values = tags,
        referenceTags = workspaceTags.map { tag -> tag.name }
    )
    database.tagDao().deleteCardTags(cardId = cardId)

    if (normalizedTags.isEmpty()) {
        database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
        return
    }

    val existingTags = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )
    val missingNames = normalizedTags.filter { normalizedTag ->
        existingTags.none { existingTag ->
            existingTag.name == normalizedTag
        }
    }
    val createdTags = missingNames.map { name ->
        TagEntity(
            tagId = UUID.randomUUID().toString(),
            workspaceId = workspaceId,
            name = name
        )
    }

    if (createdTags.isNotEmpty()) {
        database.tagDao().insertTags(tags = createdTags)
    }

    val resolvedTags = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )

    database.tagDao().insertCardTags(
        cardTags = resolvedTags.map { tag ->
            CardTagEntity(cardId = cardId, tagId = tag.tagId)
        }
    )
    database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
}

private fun normalizeDeckDraft(deckDraft: DeckDraft): DeckDraft {
    val trimmedName = deckDraft.name.trim()

    require(trimmedName.isNotEmpty()) {
        "Deck name must not be empty."
    }
    require(deckDraft.filterDefinition.version == 2) {
        "Deck filter version must be 2."
    }

    return DeckDraft(
        name = trimmedName,
        filterDefinition = buildDeckFilterDefinition(
            effortLevels = deckDraft.filterDefinition.effortLevels,
            tags = deckDraft.filterDefinition.tags
        )
    )
}

private fun toDeckSummary(
    deck: DeckEntity,
    cards: List<CardSummary>,
    nowMillis: Long
): DeckSummary {
    val filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson)
    val matchingCards = cards.filter { card ->
        matchesDeckFilterDefinition(filterDefinition = filterDefinition, card = card)
    }

    return DeckSummary(
        deckId = deck.deckId,
        workspaceId = deck.workspaceId,
        name = deck.name,
        filterDefinition = filterDefinition,
        totalCards = matchingCards.size,
        dueCards = matchingCards.count { card ->
            isCardDue(card = card, nowMillis = nowMillis)
        },
        newCards = matchingCards.count(::isNewCard),
        reviewedCards = matchingCards.count(::isReviewedCard),
        createdAtMillis = deck.createdAtMillis,
        updatedAtMillis = deck.updatedAtMillis
    )
}

private fun makeWorkspaceTagsSummary(cards: List<CardSummary>): WorkspaceTagsSummary {
    val counts = cards.fold(emptyMap<String, Int>()) { result, card ->
        card.tags.fold(result) { tagResult, tag ->
            tagResult + (tag to ((tagResult[tag] ?: 0) + 1))
        }
    }
    val tags = counts.entries.map { entry ->
        WorkspaceTagSummary(
            tag = entry.key,
            cardsCount = entry.value
        )
    }.sortedWith(
        compareByDescending<WorkspaceTagSummary> { tagSummary ->
            tagSummary.cardsCount
        }.thenBy { tagSummary ->
            tagSummary.tag.lowercase()
        }
    )

    return WorkspaceTagsSummary(
        tags = tags,
        totalCards = cards.size
    )
}

private fun makeWorkspaceTagsSummaryFromStoredTagNames(
    tagNames: List<String>,
    totalCards: Int
): WorkspaceTagsSummary {
    val tags = tagNames.map { tagName ->
        WorkspaceTagSummary(
            tag = tagName,
            cardsCount = 0
        )
    }

    return WorkspaceTagsSummary(
        tags = tags,
        totalCards = totalCards
    )
}

private fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    return encodeDeckFilterDefinitionJson(filterDefinition = filterDefinition)
}

private fun decodeDeckFilterDefinition(filterDefinitionJson: String): DeckFilterDefinition {
    return decodeDeckFilterDefinitionJson(filterDefinitionJson = filterDefinitionJson)
}
