package com.flashcardsopensourceapp.data.local.repository.review

import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.review.ReviewDueBadgeCountRow
import com.flashcardsopensourceapp.data.local.database.review.ReviewTagCardRow
import com.flashcardsopensourceapp.data.local.database.review.activeReviewRecentPriorityWindowMillis
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.cards.DeckSummary
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHead
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHeadCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.scheduling.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.review.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.cards.isCardDue
import com.flashcardsopensourceapp.data.local.model.scheduling.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.review.matchesReviewFilter
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.repository.decks.decodeDeckFilterDefinition
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest

internal const val reviewSessionCanonicalQueueSize: Int = 8
internal const val reviewSessionQueueLookaheadSize: Int = 1

internal sealed interface ReviewTagPredicate {
    data object None : ReviewTagPredicate

    data object MatchNone : ReviewTagPredicate

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

internal data class ReviewQueuePredicate(
    val tagPredicate: ReviewTagPredicate
)

internal data class CurrentReviewQueuePredicate(
    val workspaceId: String,
    val predicate: ReviewQueuePredicate
)

internal data class ReviewSessionQueryBase(
    val workspaceId: String,
    val resolvedFilter: ReviewFilter,
    val predicate: ReviewQueuePredicate,
    val decksForResolution: List<DeckSummary>,
    val storedTagNames: List<String>,
    val settings: WorkspaceSchedulerSettings
)

internal fun makeEmptyReviewSessionSnapshot(nowMillis: Long): ReviewSessionSnapshot {
    return buildBoundedReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        decks = emptyList(),
        canonicalCards = emptyList(),
        presentedCard = null,
        preparedNextCard = null,
        dueCount = 0,
        remainingCount = 0,
        totalCount = 0,
        hasMoreCards = false,
        reviewTagNames = emptyList(),
        nextDueAtMillis = null,
        settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "",
            updatedAtMillis = nowMillis
        ),
        reviewedAtMillis = nowMillis
    )
}

internal fun makeReviewQueuePredicate(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    storedTagNames: List<String>
): ReviewQueuePredicate {
    return when (selectedFilter) {
        ReviewFilter.AllCards -> ReviewQueuePredicate(
            tagPredicate = ReviewTagPredicate.None
        )

        is ReviewFilter.Deck -> {
            val deck: DeckSummary = requireNotNull(decks.firstOrNull { deck ->
                deck.deckId == selectedFilter.deckId
            }) {
                "Cannot build review queue predicate for missing deck: ${selectedFilter.deckId}"
            }
            makeReviewQueuePredicate(
                filterDefinition = deck.filterDefinition,
                storedTagNames = storedTagNames
            )
        }

        is ReviewFilter.Tags -> ReviewQueuePredicate(
            tagPredicate = makeReviewTagPredicate(
                requestedTagNames = selectedFilter.tags,
                storedTagNames = storedTagNames,
                emptySelectionMatchesNone = true
            )
        )
    }
}

internal fun makeReviewQueuePredicate(
    filterDefinition: DeckFilterDefinition,
    storedTagNames: List<String>
): ReviewQueuePredicate {
    return ReviewQueuePredicate(
        tagPredicate = makeReviewTagPredicate(
            requestedTagNames = filterDefinition.tags,
            storedTagNames = storedTagNames,
            emptySelectionMatchesNone = false
        )
    )
}

private fun makeReviewTagPredicate(
    requestedTagNames: List<String>,
    storedTagNames: List<String>,
    emptySelectionMatchesNone: Boolean
): ReviewTagPredicate {
    val requestedTagKeys: List<String> = requestedTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.filter { tagKey ->
        tagKey.isNotEmpty()
    }.distinct()
    if (requestedTagKeys.isEmpty()) {
        return if (emptySelectionMatchesNone) {
            ReviewTagPredicate.MatchNone
        } else {
            ReviewTagPredicate.None
        }
    }

    val requestedTagKeySet: Set<String> = requestedTagKeys.toSet()
    val exactTagNames: List<String> = storedTagNames.filter { storedTagName ->
        requestedTagKeySet.contains(normalizeTagKey(tag = storedTagName))
    }.distinct()

    return if (exactTagNames.isEmpty()) {
        ReviewTagPredicate.MatchNone
    } else {
        ReviewTagPredicate.ExactTagNames(tagNames = exactTagNames)
    }
}

internal fun observeActiveReviewQueue(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate,
    limit: Int
): Flow<List<CardWithRelations>> {
    require(limit > 0) {
        "Review queue load limit must be positive."
    }

    val cutoffMillis = nowMillis - activeReviewRecentPriorityWindowMillis
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.MatchNone -> flowOf(emptyList<CardWithRelations>())
        ReviewTagPredicate.None -> database.reviewQueueDao().observeBucketedActiveReviewQueue(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            limit = limit
        )

        is ReviewTagPredicate.ExactTagNames -> database.reviewQueueDao().observeBucketedActiveReviewQueueByAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            tagNames = tagPredicate.tagNames,
            limit = limit
        )
    }
}

internal fun observeReviewDueBadgeCountForPredicate(
    database: AppDatabase,
    workspaceId: String,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return observeAtReviewDueClock(
        observeAt = { nowMillis ->
            observeReviewDueCountRow(
                database = database,
                workspaceId = workspaceId,
                nowMillis = nowMillis,
                predicate = predicate
            )
        },
        nextDueAtMillis = ReviewDueBadgeCountRow::nextDueAtMillis
    ).map { row -> row.dueCount }
}

internal fun observeReviewQueueHeadForPredicate(
    database: AppDatabase,
    workspaceId: String,
    predicate: ReviewQueuePredicate
): Flow<ReviewQueueHead> {
    return observeAtReviewDueClock(
        observeAt = { nowMillis ->
            combine(
                observeReviewDueCountRow(
                    database = database,
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    predicate = predicate
                ),
                observeActiveReviewQueue(
                    database = database,
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    predicate = predicate,
                    limit = 1
                )
            ) { row, cards ->
                ReviewQueueHead(
                    workspaceId = workspaceId,
                    dueCount = row.dueCount,
                    nextDueAtMillis = row.nextDueAtMillis,
                    topCard = cards.firstOrNull()?.card?.let { card ->
                        ReviewQueueHeadCard(cardId = card.cardId, frontText = card.frontText)
                    }
                )
            }
        },
        nextDueAtMillis = ReviewQueueHead::nextDueAtMillis
    )
}

/**
 * Re-queries with a fresh `now` once the next card becomes due, so due counts stay current without
 * polling. Every collection owns its own clock.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun <T> observeAtReviewDueClock(
    observeAt: (nowMillis: Long) -> Flow<T>,
    nextDueAtMillis: (T) -> Long?
): Flow<T> {
    return flow {
        val nowMillisState = MutableStateFlow(value = System.currentTimeMillis())
        emitAll(
            nowMillisState.flatMapLatest(observeAt).transformLatest { value ->
                emit(value)
                val dueAtMillis: Long = nextDueAtMillis(value) ?: return@transformLatest
                delay(timeMillis = dueAtMillis - System.currentTimeMillis())
                // At least the next due time, so that card counts even if the wall clock lags the delay.
                nowMillisState.value = maxOf(System.currentTimeMillis(), dueAtMillis)
            }
        )
    }
}

/** Due count and the earliest future due time, both at [nowMillis]. */
internal fun observeReviewDueCountRow(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate
): Flow<ReviewDueBadgeCountRow> {
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.MatchNone -> flowOf(ReviewDueBadgeCountRow(dueCount = 0, nextDueAtMillis = null))
        ReviewTagPredicate.None -> database.reviewCountDao().observeReviewDueBadgeCount(
            workspaceId = workspaceId,
            nowMillis = nowMillis
        )

        is ReviewTagPredicate.ExactTagNames -> database.reviewCountDao().observeReviewDueBadgeCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = tagPredicate.tagNames
        )
    }
}

internal fun observeReviewTotalCount(
    database: AppDatabase,
    workspaceId: String,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.MatchNone -> flowOf(0)
        ReviewTagPredicate.None -> database.reviewCountDao().observeReviewTotalCount(workspaceId = workspaceId)

        is ReviewTagPredicate.ExactTagNames -> database.reviewCountDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = tagPredicate.tagNames
        )
    }
}

/**
 * Review tag names, re-read with the full join only when tags, card-tag links, or the live card count
 * change. A rating writes none of them, so it never re-reads every card for this.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal fun observeReviewTagNamesOffRatingPath(
    database: AppDatabase,
    workspaceId: String
): Flow<List<String>> {
    return combine(
        database.invalidationTracker.createFlow("tags", "card_tags"),
        // A local delete writes only the card row; the live count is how it reaches this flow.
        database.reviewCountDao().observeReviewTotalCount(workspaceId = workspaceId).distinctUntilChanged()
    ) { _, _ ->
        Unit
    }.map {
        database.tagDao().loadReviewTagNames(workspaceId = workspaceId)
    }.distinctUntilChanged()
}

/** The shown card and the prepared next card by id, so both stay pinned outside the queue window. */
internal fun observePinnedReviewCards(
    database: AppDatabase,
    workspaceId: String,
    cardIds: List<String>
): Flow<List<CardWithRelations>> {
    return if (cardIds.isEmpty()) {
        flowOf(emptyList())
    } else {
        database.cardDao().observeCardsWithRelationsByWorkspaceAndIds(
            workspaceId = workspaceId,
            cardIds = cardIds
        )
    }
}

internal fun observePendingReviewedCards(
    database: AppDatabase,
    workspaceId: String,
    pendingReviewedCards: Set<PendingReviewedCard>
): Flow<List<CardWithRelations>> {
    val cardIds: List<String> = pendingReviewedCards.map { pendingReviewedCard ->
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

internal fun isPendingReviewCardCounted(
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

/** The pinned card while it is still in review: in the queue window, or loaded and still due in the filter. */
internal fun resolvePinnedCardStillInReview(
    canonicalCards: List<CardSummary>,
    loadedPinnedCard: CardSummary?,
    pinnedCardId: String?,
    pendingReviewedCards: Set<PendingReviewedCard>,
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    nowMillis: Long
): CardSummary? {
    if (pinnedCardId == null) {
        return null
    }

    val canonicalPinnedCard: CardSummary? = canonicalCards.firstOrNull { card ->
        card.cardId == pinnedCardId
    }
    if (canonicalPinnedCard != null) {
        return canonicalPinnedCard
    }

    val candidate: CardSummary = loadedPinnedCard ?: return null
    return if (
        isPreservablePinnedCard(
            card = candidate,
            pendingReviewedCards = pendingReviewedCards,
            selectedFilter = selectedFilter,
            decks = decks,
            nowMillis = nowMillis
        )
    ) {
        candidate
    } else {
        null
    }
}

/**
 * The shown card stays until rated; if it leaves review, the prepared next card takes its place.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal fun resolvePresentedCardSummary(
    canonicalCards: List<CardSummary>,
    presentedCardStillInReview: CardSummary?,
    presentedCardId: String?,
    preparedNextCardStillInReview: CardSummary?
): CardSummary? {
    if (presentedCardId == null) {
        return canonicalCards.firstOrNull()
    }

    return presentedCardStillInReview ?: preparedNextCardStillInReview ?: canonicalCards.firstOrNull()
}

/**
 * The prepared next card stays next while it is still in review, so newly due or reordered cards queue
 * behind it; otherwise the first other queued card is prepared.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal fun resolvePreparedNextCardSummary(
    canonicalCards: List<CardSummary>,
    presentedCard: CardSummary?,
    preparedNextCardStillInReview: CardSummary?
): CardSummary? {
    val presentedCardId: String? = presentedCard?.cardId
    if (preparedNextCardStillInReview != null && preparedNextCardStillInReview.cardId != presentedCardId) {
        return preparedNextCardStillInReview
    }

    return canonicalCards.firstOrNull { card ->
        card.cardId != presentedCardId
    }
}

private fun isPreservablePinnedCard(
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

internal fun buildReviewTagFilterOptionsFromRows(
    rows: List<ReviewTagCardRow>,
    storedTagNames: List<String>
): List<ReviewTagFilterOption> {
    val cardIdsByTagKey: Map<String, Set<String>> = rows.groupBy { row ->
        normalizeTagKey(tag = row.tag)
    }.mapValues { (_, tagRows) ->
        tagRows.map(ReviewTagCardRow::cardId).toSet()
    }
    return storedTagNames.groupBy { tagName ->
        normalizeTagKey(tag = tagName)
    }.map { (tagKey, equivalentTagNames) ->
        val canonicalTagName: String = equivalentTagNames.minWith(
            compareBy<String> { tagName ->
                tagName.lowercase()
            }.thenBy { tagName ->
                tagName
            }
        )
        ReviewTagFilterOption(
            tag = canonicalTagName,
            totalCount = cardIdsByTagKey[tagKey]?.size ?: 0
        )
    }.sortedWith(
        compareBy<ReviewTagFilterOption> { option ->
            option.tag.lowercase()
        }.thenBy { option ->
            option.tag
        }
    )
}

internal suspend fun loadReviewDeckSummaries(
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
                val filterDefinition: DeckFilterDefinition = decodeDeckFilterDefinition(
                    filterDefinitionJson = deck.filterDefinitionJson
                )
                val dueCards: Int = countReviewDueCards(
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

internal suspend fun countReviewDueCards(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate
): Int {
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
        ReviewTagPredicate.MatchNone -> 0
        ReviewTagPredicate.None -> database.reviewCountDao().countReviewDueCards(
            workspaceId = workspaceId,
            nowMillis = nowMillis
        )

        is ReviewTagPredicate.ExactTagNames -> database.reviewCountDao().countReviewDueCardsByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = tagPredicate.tagNames
        )
    }
}

internal fun toReviewDeckSummary(deck: DeckEntity, dueCards: Int): DeckSummary {
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

internal fun matchesPendingReviewedCard(
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
