package com.flashcardsopensourceapp.data.local.model

// Keep review queue ordering aligned with:
// - apps/ios/Flashcards/Flashcards/Review/ReviewQuerySupport.swift::compareCardsForReviewOrder
// - apps/ios/Flashcards/Flashcards/Database/CardStore+ReadSQL.swift review queue ORDER BY
// - apps/web/src/appData/domain.ts::compareCardsForReviewOrder
// Ordering contract: recent due cards within the inclusive one-hour window first,
// then older due cards, then null due/new cards, then future cards, followed by earlier dueAt,
// newer createdAt, then cardId ascending.
// If this changes, mirror the same change across all three clients in the same change.
private const val recentDuePriorityWindowMillis: Long = 60L * 60L * 1_000L

private fun reviewOrderRank(card: CardSummary, nowMillis: Long): Int {
    val dueAtMillis = card.dueAtMillis
    val recentDueCutoffMillis = nowMillis - recentDuePriorityWindowMillis
    return when {
        dueAtMillis != null && dueAtMillis >= recentDueCutoffMillis && dueAtMillis <= nowMillis -> 0
        dueAtMillis != null && dueAtMillis < recentDueCutoffMillis -> 1
        dueAtMillis == null -> 2
        else -> 3
    }
}

private fun sortCardsForReviewQueue(cards: List<CardSummary>, nowMillis: Long): List<CardSummary> {
    return cards.sortedWith(
        compareBy<CardSummary> { card ->
            reviewOrderRank(card = card, nowMillis = nowMillis)
        }.thenBy { card ->
            card.dueAtMillis ?: Long.MIN_VALUE
        }.thenByDescending { card ->
            card.createdAtMillis
        }.thenBy { card ->
            card.cardId
        }
    )
}

private fun matchesReviewFilter(filter: ReviewFilter, decks: List<DeckSummary>, card: CardSummary): Boolean {
    return when (filter) {
        ReviewFilter.AllCards -> true
        is ReviewFilter.Deck -> {
            val matchingDeck = decks.firstOrNull { deck ->
                deck.deckId == filter.deckId
            } ?: return false

            matchesDeckFilterDefinition(
                filterDefinition = matchingDeck.filterDefinition,
                card = card
            )
        }

        is ReviewFilter.Effort -> {
            card.effortLevel == filter.effortLevel
        }

        is ReviewFilter.Tag -> {
            val requestedTagKey = normalizeTagKey(tag = filter.tag)
            card.tags.any { tag ->
                normalizeTagKey(tag = tag) == requestedTagKey
            }
        }
    }
}

fun resolveReviewFilter(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    tagsSummary: WorkspaceTagsSummary
): ReviewFilter {
    return when (selectedFilter) {
        ReviewFilter.AllCards -> ReviewFilter.AllCards
        is ReviewFilter.Deck -> {
            val matchingDeck = decks.firstOrNull { deck ->
                deck.deckId == selectedFilter.deckId
            }

            if (matchingDeck == null) {
                ReviewFilter.AllCards
            } else {
                ReviewFilter.Deck(deckId = matchingDeck.deckId)
            }
        }

        is ReviewFilter.Effort -> {
            ReviewFilter.Effort(effortLevel = selectedFilter.effortLevel)
        }

        is ReviewFilter.Tag -> {
            val matchingTag = tagsSummary.tags.firstOrNull { tagSummary ->
                normalizeTagKey(tag = tagSummary.tag) == normalizeTagKey(tag = selectedFilter.tag)
            }

            if (matchingTag == null) {
                ReviewFilter.AllCards
            } else {
                ReviewFilter.Tag(tag = matchingTag.tag)
            }
        }
    }
}

fun reviewFilterTitle(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>
): String {
    return when (selectedFilter) {
        ReviewFilter.AllCards -> "All cards"
        is ReviewFilter.Deck -> decks.firstOrNull { deck ->
            deck.deckId == selectedFilter.deckId
        }?.name ?: "All cards"

        is ReviewFilter.Effort -> formatCardEffortLabel(effortLevel = selectedFilter.effortLevel)
        is ReviewFilter.Tag -> selectedFilter.tag
    }
}

private fun dueCardsMatchingReviewFilter(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    cards: List<CardSummary>,
    reviewedAtMillis: Long
): List<CardSummary> {
    return sortCardsForReviewQueue(
        nowMillis = reviewedAtMillis,
        cards = cards.filter { card ->
            matchesReviewFilter(
                filter = selectedFilter,
                decks = decks,
                card = card
            ) && isCardDue(card = card, nowMillis = reviewedAtMillis)
        }
    )
}

private fun cardsMatchingReviewFilter(
    selectedFilter: ReviewFilter,
    decks: List<DeckSummary>,
    cards: List<CardSummary>
): List<CardSummary> {
    return cards.filter { card ->
        matchesReviewFilter(
            filter = selectedFilter,
            decks = decks,
            card = card
        )
    }
}

private fun buildReviewAnswerOptionsByCardId(
    cards: List<CardSummary>,
    settings: WorkspaceSchedulerSettings,
    reviewedAtMillis: Long
): Map<String, List<ReviewAnswerOption>> {
    return cards.associate { card ->
        card.cardId to makeReviewAnswerOptions(
            card = card,
            settings = settings,
            reviewedAtMillis = reviewedAtMillis
        )
    }
}

fun buildReviewDeckFilterOptions(decks: List<DeckSummary>): List<ReviewDeckFilterOption> {
    return decks.map { deck ->
        ReviewDeckFilterOption(
            deckId = deck.deckId,
            title = deck.name,
            totalCount = deck.dueCards
        )
    }.sortedWith(
        compareBy<ReviewDeckFilterOption> { option ->
            option.title.lowercase()
        }.thenBy { option ->
            option.deckId
        }
    )
}

fun buildReviewEffortFilterOptions(
    cards: List<CardSummary>,
    reviewedAtMillis: Long
): List<ReviewEffortFilterOption> {
    val dueCards = cards.filter { card ->
        isCardDue(card = card, nowMillis = reviewedAtMillis)
    }
    val counts = dueCards.groupingBy { card ->
        card.effortLevel
    }.eachCount()

    return EffortLevel.entries.map { effortLevel ->
        ReviewEffortFilterOption(
            effortLevel = effortLevel,
            title = formatCardEffortLabel(effortLevel = effortLevel),
            totalCount = counts[effortLevel] ?: 0
        )
    }
}

fun buildReviewTagFilterOptions(cards: List<CardSummary>, reviewedAtMillis: Long): List<ReviewTagFilterOption> {
    val dueCards = cards.filter { card ->
        isCardDue(card = card, nowMillis = reviewedAtMillis)
    }
    val counts = dueCards.fold(emptyMap<String, Int>()) { result, card ->
        card.tags.fold(result) { tagResult, tag ->
            tagResult + (tag to ((tagResult[tag] ?: 0) + 1))
        }
    }

    return counts.entries.map { entry ->
        ReviewTagFilterOption(
            tag = entry.key,
            totalCount = entry.value
        )
    }.sortedWith(
        compareBy<ReviewTagFilterOption> { option ->
            option.tag.lowercase()
        }.thenBy { option ->
            option.tag
        }
    )
}

fun buildReviewSessionSnapshot(
    selectedFilter: ReviewFilter,
    pendingReviewedCards: Set<PendingReviewedCard>,
    presentedCardId: String?,
    decks: List<DeckSummary>,
    cards: List<CardSummary>,
    tagsSummary: WorkspaceTagsSummary,
    settings: WorkspaceSchedulerSettings,
    reviewedAtMillis: Long
): ReviewSessionSnapshot {
    val resolvedFilter = resolveReviewFilter(
        selectedFilter = selectedFilter,
        decks = decks,
        tagsSummary = tagsSummary
    )
    val matchingCards = dueCardsMatchingReviewFilter(
        selectedFilter = resolvedFilter,
        decks = decks,
        cards = cards,
        reviewedAtMillis = reviewedAtMillis
    )
    val remainingCards = matchingCards.filter { card ->
        matchesPendingReviewedCard(
            pendingReviewedCards = pendingReviewedCards,
            card = card
        ).not()
    }
    val currentCard = remainingCards.firstOrNull()
    val nextCard = remainingCards.getOrNull(index = 1)
    val presentedCard = presentedCardId?.let { cardId ->
        remainingCards.firstOrNull { card ->
            card.cardId == cardId
        }
    }
    val answerOptionCards = listOfNotNull(
        currentCard,
        nextCard,
        presentedCard
    ).distinctBy { card ->
        card.cardId
    }
    val answerOptionsByCardId = buildReviewAnswerOptionsByCardId(
        cards = answerOptionCards,
        settings = settings,
        reviewedAtMillis = reviewedAtMillis
    )

    return ReviewSessionSnapshot(
        selectedFilter = resolvedFilter,
        selectedFilterTitle = reviewFilterTitle(
            selectedFilter = resolvedFilter,
            decks = decks
        ),
        cards = remainingCards.map(::toReviewCard),
        answerOptions = currentCard?.let { card ->
            answerOptionsByCardId[card.cardId]
        } ?: emptyList(),
        nextAnswerOptions = nextCard?.let { card ->
            answerOptionsByCardId[card.cardId]
        } ?: emptyList(),
        answerOptionsByCardId = answerOptionsByCardId,
        remainingCount = remainingCards.size,
        totalCount = matchingCards.size,
        availableDeckFilters = buildReviewDeckFilterOptions(decks = decks),
        availableEffortFilters = buildReviewEffortFilterOptions(
            cards = cards,
            reviewedAtMillis = reviewedAtMillis
        ),
        availableTagFilters = buildReviewTagFilterOptions(
            cards = cards,
            reviewedAtMillis = reviewedAtMillis
        ),
        isLoading = false
    )
}

fun buildReviewTimelinePage(
    selectedFilter: ReviewFilter,
    pendingReviewedCards: Set<PendingReviewedCard>,
    decks: List<DeckSummary>,
    cards: List<CardSummary>,
    tagsSummary: WorkspaceTagsSummary,
    reviewedAtMillis: Long,
    offset: Int,
    limit: Int
): ReviewTimelinePage {
    require(offset >= 0) {
        "Review timeline offset must be non-negative."
    }
    require(limit > 0) {
        "Review timeline limit must be positive."
    }

    val resolvedFilter = resolveReviewFilter(
        selectedFilter = selectedFilter,
        decks = decks,
        tagsSummary = tagsSummary
    )
    val matchingCards = cardsMatchingReviewFilter(
        selectedFilter = resolvedFilter,
        decks = decks,
        cards = cards
    )
    val dueCards = sortCardsForReviewQueue(
        nowMillis = reviewedAtMillis,
        cards = matchingCards.filter { card ->
            isCardDue(card = card, nowMillis = reviewedAtMillis)
        }
    )
    val futureCards = sortCardsForReviewQueue(
        nowMillis = reviewedAtMillis,
        cards = matchingCards.filter { card ->
            isCardDue(card = card, nowMillis = reviewedAtMillis).not()
        }
    )
    val remainingCards = dueCards.filter { card ->
        matchesPendingReviewedCard(
            pendingReviewedCards = pendingReviewedCards,
            card = card
        ).not()
    }
    val alreadyReviewedCards = dueCards.filter { card ->
        matchesPendingReviewedCard(
            pendingReviewedCards = pendingReviewedCards,
            card = card
        )
    }
    val orderedCards = buildList {
        addAll(remainingCards.map { card ->
            toReviewCard(
                card = card,
                queueStatus = ReviewCardQueueStatus.ACTIVE
            )
        })
        addAll(futureCards.map { card ->
            toReviewCard(
                card = card,
                queueStatus = ReviewCardQueueStatus.FUTURE
            )
        })
        addAll(alreadyReviewedCards.map { card ->
            toReviewCard(
                card = card,
                queueStatus = ReviewCardQueueStatus.RATED
            )
        })
    }
    val pageCards = orderedCards.drop(offset).take(limit)

    return ReviewTimelinePage(
        cards = pageCards,
        hasMoreCards = offset + pageCards.size < orderedCards.size
    )
}

fun toReviewCard(
    card: CardSummary,
    queueStatus: ReviewCardQueueStatus = ReviewCardQueueStatus.ACTIVE
): ReviewCard {
    return ReviewCard(
        cardId = card.cardId,
        frontText = card.frontText,
        backText = card.backText,
        tags = card.tags,
        effortLevel = card.effortLevel,
        dueAtMillis = card.dueAtMillis,
        updatedAtMillis = card.updatedAtMillis,
        createdAtMillis = card.createdAtMillis,
        reps = card.reps,
        lapses = card.lapses,
        queueStatus = queueStatus
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
