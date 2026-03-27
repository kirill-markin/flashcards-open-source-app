package com.flashcardsopensourceapp.data.local.repository

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportCard
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.buildReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.computeReviewSchedule
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.encodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.isNewCard
import com.flashcardsopensourceapp.data.local.model.isReviewedCard
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.makeReviewAnswerOptions
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.model.queryCards
import com.flashcardsopensourceapp.data.local.model.validateWorkspaceSchedulerSettingsInput
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import java.util.UUID

class LocalCardsRepository(
    private val database: AppDatabase,
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
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before creating cards."
        }
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

        database.withTransaction {
            database.cardDao().insertCard(card = card)
            replaceCardTags(
                database = database,
                workspaceId = workspace.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(card = card, tags = cardDraft.tags)
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

        database.withTransaction {
            database.cardDao().updateCard(card = updatedCard)
            replaceCardTags(
                database = database,
                workspaceId = currentCard.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(card = updatedCard, tags = cardDraft.tags)
        }
    }

    override suspend fun deleteCard(cardId: String) {
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot delete missing card: $cardId"
        }

        database.withTransaction {
            val deletedCard = card.copy(
                updatedAtMillis = System.currentTimeMillis(),
                deletedAtMillis = System.currentTimeMillis()
            )
            val cardTags = database.cardDao().observeCardWithRelations(cardId = cardId).first()?.tags?.map(TagEntity::name) ?: emptyList()
            database.cardDao().updateCard(card = deletedCard)
            syncLocalStore.enqueueCardUpsert(card = deletedCard, tags = cardTags)
        }
    }
}

class LocalDecksRepository(
    private val database: AppDatabase,
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
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before creating decks."
        }
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

        database.deckDao().insertDeck(deck = deck)
        syncLocalStore.enqueueDeckUpsert(deck)
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

        database.deckDao().updateDeck(deck = updatedDeck)
        syncLocalStore.enqueueDeckUpsert(updatedDeck)
    }

    override suspend fun deleteDeck(deckId: String) {
        val existingDeck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot delete missing deck: $deckId"
        }

        val deletedDeck = existingDeck.copy(
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = System.currentTimeMillis()
        )
        database.deckDao().updateDeck(deck = deletedDeck)
        syncLocalStore.enqueueDeckUpsert(deletedDeck)
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
        return database.workspaceDao().observeWorkspace().map { workspace ->
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
            database.cardDao().observeCardCount(),
            preferencesStore.observeCloudSettings(),
            syncRepository.observeSyncStatus()
        ) { overview, cardCount, cloudSettings, syncStatusSnapshot ->
            AppMetadataSummary(
                currentWorkspaceName = overview?.workspaceName ?: "Unavailable",
                workspaceName = overview?.workspaceName ?: "Unavailable",
                deckCount = overview?.deckCount ?: 0,
                cardCount = cardCount,
                localStorageLabel = "Room + SQLite",
                syncStatusText = when (cloudSettings.cloudState) {
                    CloudAccountState.DISCONNECTED -> "Not connected"
                    CloudAccountState.LINKING_READY -> "Sign-in complete, choose a workspace"
                    CloudAccountState.GUEST -> "Guest AI session"
                    CloudAccountState.LINKED -> when (val syncStatus = syncStatusSnapshot.status) {
                        is com.flashcardsopensourceapp.data.local.model.SyncStatus.Failed -> syncStatus.message
                        com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle -> "Synced"
                        com.flashcardsopensourceapp.data.local.model.SyncStatus.Syncing -> "Syncing"
                    }
                }
            )
        }
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return combine(
            database.workspaceDao().observeWorkspace(),
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations()
        ) { workspace, decks, cards ->
            if (workspace == null) {
                return@combine null
            }

            val cardSummaries = cards.map(::toCardSummary)
            val nowMillis = System.currentTimeMillis()
            val tagsSummary = makeWorkspaceTagsSummary(cards = cardSummaries)

            WorkspaceOverviewSummary(
                workspaceId = workspace.workspaceId,
                workspaceName = workspace.name,
                totalCards = cardSummaries.count { card -> card.deletedAtMillis == null },
                deckCount = decks.count { deck -> deck.deletedAtMillis == null },
                tagsCount = tagsSummary.tags.size,
                dueCount = cardSummaries.count { card ->
                    card.deletedAtMillis == null && isCardDue(card = card, nowMillis = nowMillis)
                },
                newCount = cardSummaries.count { card -> card.deletedAtMillis == null && isNewCard(card) },
                reviewedCount = cardSummaries.count { card -> card.deletedAtMillis == null && isReviewedCard(card) }
            )
        }
    }

    override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
        return database.workspaceDao().observeWorkspace().flatMapLatest { workspace ->
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
        return database.cardDao().observeCardsWithRelations().map { cards ->
            makeWorkspaceTagsSummary(cards = cards.map(::toCardSummary))
        }
    }

    override fun observeDeviceDiagnostics(): Flow<DeviceDiagnosticsSummary?> {
        return database.workspaceDao().observeWorkspace().flatMapLatest { workspace ->
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
        val workspace = database.workspaceDao().loadWorkspace() ?: return null
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
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before updating scheduler settings."
        }
        val updatedSettings = validateWorkspaceSchedulerSettingsInput(
            workspaceId = workspace.workspaceId,
            desiredRetention = desiredRetention,
            learningStepsMinutes = learningStepsMinutes,
            relearningStepsMinutes = relearningStepsMinutes,
            maximumIntervalDays = maximumIntervalDays,
            enableFuzz = enableFuzz,
            updatedAtMillis = System.currentTimeMillis()
        )

        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            settings = toWorkspaceSchedulerSettingsEntity(settings = updatedSettings)
        )
        syncLocalStore.enqueueWorkspaceSchedulerSettingsUpsert(
            settings = toWorkspaceSchedulerSettingsEntity(settings = updatedSettings)
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class LocalReviewRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore
) : ReviewRepository {
    override fun observeReviewSession(
        selectedFilter: ReviewFilter,
        pendingReviewedCardIds: Set<String>
    ): Flow<ReviewSessionSnapshot> {
        return combine(
            database.workspaceDao().observeWorkspace(),
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations(),
            database.workspaceDao().observeWorkspace().flatMapLatest { workspace ->
                if (workspace == null) {
                    return@flatMapLatest flowOf(null)
                }

                database.workspaceSchedulerSettingsDao().observeWorkspaceSchedulerSettings(
                    workspaceId = workspace.workspaceId
                )
            }
        ) { workspace, decks, cards, settingsEntity ->
            val nowMillis = System.currentTimeMillis()
            val cardSummaries = cards.map(::toCardSummary).filter { card -> card.deletedAtMillis == null }
            val deckSummaries = decks.filter { deck -> deck.deletedAtMillis == null }.map { deck ->
                toDeckSummary(
                    deck = deck,
                    cards = cardSummaries,
                    nowMillis = nowMillis
                )
            }
            val workspaceId = workspace?.workspaceId ?: cardSummaries.firstOrNull()?.workspaceId.orEmpty()
            val settings = settingsEntity?.let(::toWorkspaceSchedulerSettings)
                ?: makeDefaultWorkspaceSchedulerSettings(
                    workspaceId = workspaceId,
                    updatedAtMillis = nowMillis
                )

            buildReviewSessionSnapshot(
                selectedFilter = selectedFilter,
                pendingReviewedCardIds = pendingReviewedCardIds,
                decks = deckSummaries,
                cards = cardSummaries,
                tagsSummary = makeWorkspaceTagsSummary(cards = cardSummaries),
                settings = settings,
                reviewedAtMillis = nowMillis
            )
        }
    }

    override suspend fun loadReviewTimelinePage(
        selectedFilter: ReviewFilter,
        pendingReviewedCardIds: Set<String>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage {
        val cards = database.cardDao().observeCardsWithRelations().first()
        val decks = database.deckDao().observeDecks().first()
        val cardSummaries = cards.map(::toCardSummary).filter { card -> card.deletedAtMillis == null }
        val deckSummaries = decks.filter { deck -> deck.deletedAtMillis == null }.map { deck ->
            toDeckSummary(
                deck = deck,
                cards = cardSummaries,
                nowMillis = System.currentTimeMillis()
            )
        }

        return buildReviewTimelinePage(
            selectedFilter = selectedFilter,
            pendingReviewedCardIds = pendingReviewedCardIds,
            decks = deckSummaries,
            cards = cardSummaries,
            tagsSummary = makeWorkspaceTagsSummary(cards = cardSummaries),
            reviewedAtMillis = System.currentTimeMillis(),
            offset = offset,
            limit = limit
        )
    }

    override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
        database.withTransaction {
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
            database.reviewLogDao().insertReviewLog(
                reviewLog = ReviewLogEntity(
                    reviewLogId = UUID.randomUUID().toString(),
                    workspaceId = card.workspaceId,
                    cardId = cardId,
                    deviceId = preferencesStore.currentCloudSettings().deviceId,
                    clientEventId = UUID.randomUUID().toString(),
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis,
                    reviewedAtServerIso = formatIsoTimestamp(reviewedAtMillis)
                )
            )
            val insertedReviewLog = database.reviewLogDao().loadReviewLogs().first()
            syncLocalStore.enqueueReviewEventAppend(insertedReviewLog)
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
                tags = cardSummary.tags
            )
        }
    }
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

private fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    return encodeDeckFilterDefinitionJson(filterDefinition = filterDefinition)
}

private fun decodeDeckFilterDefinition(filterDefinitionJson: String): DeckFilterDefinition {
    return decodeDeckFilterDefinitionJson(filterDefinitionJson = filterDefinitionJson)
}
