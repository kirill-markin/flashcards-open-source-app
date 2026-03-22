package com.flashcardsopensourceapp.data.local.model

private fun sortCardsForReviewQueue(cards: List<CardSummary>): List<CardSummary> {
    return cards.sortedWith(
        compareBy<CardSummary> { card ->
            when {
                card.dueAtMillis == null -> 0L
                else -> card.dueAtMillis
            }
        }.thenBy { card ->
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
        cards = cards.filter { card ->
            matchesReviewFilter(
                filter = selectedFilter,
                decks = decks,
                card = card
            ) && isCardDue(card = card, nowMillis = reviewedAtMillis)
        }
    )
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
    pendingReviewedCardIds: Set<String>,
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
        pendingReviewedCardIds.contains(card.cardId).not()
    }
    val currentCard = remainingCards.firstOrNull()

    return ReviewSessionSnapshot(
        selectedFilter = resolvedFilter,
        selectedFilterTitle = reviewFilterTitle(
            selectedFilter = resolvedFilter,
            decks = decks
        ),
        cards = remainingCards.map(::toReviewCard),
        answerOptions = currentCard?.let { card ->
            makeReviewAnswerOptions(
                card = card,
                settings = settings,
                reviewedAtMillis = reviewedAtMillis
            )
        } ?: emptyList(),
        remainingCount = remainingCards.size,
        totalCount = matchingCards.size,
        availableDeckFilters = buildReviewDeckFilterOptions(decks = decks),
        availableTagFilters = buildReviewTagFilterOptions(
            cards = cards,
            reviewedAtMillis = reviewedAtMillis
        ),
        isLoading = false
    )
}

fun buildReviewTimelinePage(
    selectedFilter: ReviewFilter,
    pendingReviewedCardIds: Set<String>,
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
    val matchingCards = dueCardsMatchingReviewFilter(
        selectedFilter = resolvedFilter,
        decks = decks,
        cards = cards,
        reviewedAtMillis = reviewedAtMillis
    )
    val remainingCards = matchingCards.filter { card ->
        pendingReviewedCardIds.contains(card.cardId).not()
    }
    val alreadyReviewedCards = matchingCards.filter { card ->
        pendingReviewedCardIds.contains(card.cardId)
    }
    val orderedCards = remainingCards + alreadyReviewedCards
    val pageCards = orderedCards.drop(offset).take(limit)

    return ReviewTimelinePage(
        cards = pageCards.map(::toReviewCard),
        hasMoreCards = offset + pageCards.size < orderedCards.size
    )
}

fun toReviewCard(card: CardSummary): ReviewCard {
    return ReviewCard(
        cardId = card.cardId,
        frontText = card.frontText,
        backText = card.backText,
        tags = card.tags,
        effortLevel = card.effortLevel,
        createdAtMillis = card.createdAtMillis
    )
}
