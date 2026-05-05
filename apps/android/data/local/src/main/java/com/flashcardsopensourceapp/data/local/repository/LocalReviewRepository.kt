package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSchedule
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewDeckFilterOptions
import com.flashcardsopensourceapp.data.local.model.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.computeReviewSchedule
import com.flashcardsopensourceapp.data.local.model.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.matchesReviewFilter
import com.flashcardsopensourceapp.data.local.model.resolveReviewFilterFromTagNames
import com.flashcardsopensourceapp.data.local.model.toReviewCard
import com.flashcardsopensourceapp.data.local.repository.cloudsync.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.observeCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runLocalOutboxMutationTransaction
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressCacheStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class LocalReviewRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore,
    private val localProgressCacheStore: LocalProgressCacheStore
) : ReviewRepository {
    override fun observeReviewSession(
        selectedFilter: ReviewFilter,
        pendingReviewedCards: Set<PendingReviewedCard>,
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

            val workspaceId: String = workspace.workspaceId
            val activeDeckEntities: List<DeckEntity> = decks.filter { deck ->
                deck.workspaceId == workspaceId && deck.deletedAtMillis == null
            }

            combine(
                database.tagDao().observeReviewTagNames(workspaceId = workspaceId),
                database.workspaceSchedulerSettingsDao().observeWorkspaceSchedulerSettings(
                    workspaceId = workspaceId
                ),
                database.cardDao().observeCardCount()
            ) { storedTagNames, settingsEntity, _ ->
                val nowMillis: Long = System.currentTimeMillis()
                val decksForResolution: List<DeckSummary> = activeDeckEntities.map { deck ->
                    toReviewDeckSummary(
                        deck = deck,
                        dueCards = 0
                    )
                }
                val resolvedFilter: ReviewFilter = resolveReviewFilterFromTagNames(
                    selectedFilter = selectedFilter,
                    decks = decksForResolution,
                    tagNames = storedTagNames
                )
                val settings: WorkspaceSchedulerSettings = settingsEntity?.let(::toWorkspaceSchedulerSettings)
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
                val queueLoadLimit: Int = reviewSessionCanonicalQueueSize +
                    pendingReviewedCards.size +
                    reviewSessionQueueLookaheadSize
                val queueStateFlow: Flow<ReviewSessionQueueState> = combine(
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
                    val canonicalCandidates: List<CardSummary> = queueCards.map(::toCardSummary).filter { card ->
                        matchesPendingReviewedCard(
                            pendingReviewedCards = pendingReviewedCards,
                            card = card
                        ).not()
                    }
                    val canonicalCards: List<CardSummary> = canonicalCandidates.take(reviewSessionCanonicalQueueSize)
                    val pendingMatchingCount: Int = pendingCards.map(::toCardSummary).count { card ->
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
                val filterOptionsFlow: Flow<ReviewFilterOptionsState> = combine(
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
                    val deckSummaries: List<DeckSummary> = loadReviewDeckSummaries(
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
        pendingReviewedCards: Set<PendingReviewedCard>,
        offset: Int,
        limit: Int
    ): ReviewTimelinePage {
        val currentWorkspaceId: String? = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
        val nowMillis: Long = System.currentTimeMillis()
        val cards: List<CardWithRelations> = database.cardDao().observeCardsWithRelations().first()
        val decks: List<DeckEntity> = database.deckDao().observeDecks().first()
        val cardSummaries: List<CardSummary> = cards.map(::toCardSummary).filter { card ->
            card.deletedAtMillis == null && (currentWorkspaceId == null || card.workspaceId == currentWorkspaceId)
        }
        val deckSummaries: List<DeckSummary> = decks.filter { deck ->
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
        val workspace: WorkspaceEntity = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return null
        val nowMillis: Long = System.currentTimeMillis()
        val card: CardWithRelations = database.cardDao().observeCardWithRelationsByWorkspace(
            cardId = cardId,
            workspaceId = workspace.workspaceId
        ).first() ?: return null
        val cardSummary: CardSummary = toCardSummary(card = card)
        if (cardSummary.deletedAtMillis != null) {
            return null
        }
        if (isCardDue(card = cardSummary, nowMillis = nowMillis).not()) {
            return null
        }

        val activeDeckEntities: List<DeckEntity> = database.deckDao().observeDecks().first().filter { deck ->
            deck.workspaceId == workspace.workspaceId && deck.deletedAtMillis == null
        }
        val storedTagNames: List<String> = database.tagDao().loadReviewTagNames(workspaceId = workspace.workspaceId)
        val decksForResolution: List<DeckSummary> = activeDeckEntities.map { deck ->
            toReviewDeckSummary(
                deck = deck,
                dueCards = 0
            )
        }
        val resolvedFilter: ReviewFilter = resolveReviewFilterFromTagNames(
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
            val card: CardEntity = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
                "Cannot review missing card: $cardId"
            }
            val schedulerSettingsEntity: WorkspaceSchedulerSettingsEntity = requireNotNull(
                database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(
                    workspaceId = card.workspaceId
                )
            ) {
                "Scheduler settings are required before reviewing card: $cardId"
            }
            val cardWithRelations: CardWithRelations = requireNotNull(
                database.cardDao().observeCardWithRelations(cardId = cardId).first()
            ) {
                "Cannot load review card relations for card: $cardId"
            }
            val cardSummary: CardSummary = toCardSummary(cardWithRelations)
            val schedule: ReviewSchedule = computeReviewSchedule(
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
            val reviewLog: ReviewLogEntity = ReviewLogEntity(
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
