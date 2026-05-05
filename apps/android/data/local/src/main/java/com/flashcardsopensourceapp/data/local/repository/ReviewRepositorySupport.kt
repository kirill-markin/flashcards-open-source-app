package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewEffortCountRow
import com.flashcardsopensourceapp.data.local.database.ReviewTagCountRow
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.formatCardEffortLabel
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.matchesReviewFilter
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

internal const val reviewSessionCanonicalQueueSize: Int = 8
internal const val reviewSessionQueueLookaheadSize: Int = 1

internal sealed interface ReviewTagPredicate {
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

internal data class ReviewQueuePredicate(
    val effortLevels: List<EffortLevel>,
    val tagPredicate: ReviewTagPredicate
)

internal data class ReviewSessionQueryBase(
    val workspaceId: String,
    val resolvedFilter: ReviewFilter,
    val predicate: ReviewQueuePredicate,
    val deckEntities: List<DeckEntity>,
    val decksForResolution: List<DeckSummary>,
    val storedTagNames: List<String>,
    val settings: WorkspaceSchedulerSettings,
    val nowMillis: Long
)

internal data class ReviewSessionQueueState(
    val canonicalCards: List<CardSummary>,
    val presentedCard: CardSummary?,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean
)

internal data class ReviewFilterOptionsState(
    val effortFilters: List<ReviewEffortFilterOption>,
    val tagFilters: List<ReviewTagFilterOption>
)

internal fun makeEmptyReviewSessionSnapshot(nowMillis: Long): ReviewSessionSnapshot {
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

internal fun makeReviewQueuePredicate(
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

internal fun makeReviewQueuePredicate(
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

    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
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

internal fun observeReviewDueCount(
    database: AppDatabase,
    workspaceId: String,
    nowMillis: Long,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
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

internal fun observeReviewTotalCount(
    database: AppDatabase,
    workspaceId: String,
    predicate: ReviewQueuePredicate
): Flow<Int> {
    return when (val tagPredicate: ReviewTagPredicate = predicate.tagPredicate) {
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

internal fun observePresentedCard(
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

internal fun resolvePresentedCardSummary(
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

    val canonicalPresentedCard: CardSummary? = canonicalCards.firstOrNull { card ->
        card.cardId == presentedCardId
    }
    if (canonicalPresentedCard != null) {
        return canonicalPresentedCard
    }

    val candidate: CardSummary = loadedPresentedCard ?: return canonicalCards.firstOrNull()
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

internal fun buildReviewEffortFilterOptionsFromRows(
    rows: List<ReviewEffortCountRow>
): List<ReviewEffortFilterOption> {
    val countsByEffort: Map<EffortLevel, Int> = rows.associate { row ->
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

internal fun buildReviewTagFilterOptionsFromRows(
    rows: List<ReviewTagCountRow>
): List<ReviewTagFilterOption> {
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
