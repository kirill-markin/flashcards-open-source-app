import Foundation

struct ResolvedReviewQuery: Hashable, Sendable {
    let reviewFilter: ReviewFilter
    let queryDefinition: ReviewQueryDefinition
}

struct ReviewHeadLoadState: Hashable, Sendable {
    let resolvedReviewFilter: ReviewFilter
    let seedReviewQueue: [Card]
    let hasMoreCards: Bool
}

struct ReviewSessionCardSignature: Hashable, Sendable {
    let cardId: String
    let updatedAt: String
}

struct ReviewSessionSignature: Hashable, Sendable {
    let selectedReviewFilter: ReviewFilter
    let seedQueue: [ReviewSessionCardSignature]
    let schedulerSettingsUpdatedAt: String
}

struct ReviewQueueChunkLoadState: Hashable, Sendable {
    let reviewQueueChunk: [Card]
    let hasMoreCards: Bool
}

private func reviewOrderDueAtRank(card: Card) -> Int {
    guard let dueAt = card.dueAt else {
        return 1
    }

    guard parseIsoTimestamp(value: dueAt) != nil else {
        return 2
    }

    return 0
}

private func hasActiveTag(tag: String, cards: [Card]) -> Bool {
    deriveActiveCards(cards: cards).contains { card in
        card.tags.contains(tag)
    }
}

// Keep review queue ordering aligned with:
// - apps/ios/Flashcards/Flashcards/Database/CardStore+ReadSQL.swift review queue ORDER BY
// - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt::sortCardsForReviewQueue
// - apps/web/src/appData/domain.ts::compareCardsForReviewOrder
// Ordering contract: timed due cards first, then nil dueAt new cards, then future cards, then malformed dueAt values last.
// If this changes, mirror the same change across all three clients in the same change.
func compareCardsForReviewOrder(leftCard: Card, rightCard: Card, now: Date) -> Bool {
    let leftIsDue = isCardDue(card: leftCard, now: now)
    let rightIsDue = isCardDue(card: rightCard, now: now)
    if leftIsDue != rightIsDue {
        return leftIsDue
    }

    let leftDueRank = reviewOrderDueAtRank(card: leftCard)
    let rightDueRank = reviewOrderDueAtRank(card: rightCard)
    if leftDueRank != rightDueRank {
        return leftDueRank < rightDueRank
    }

    if
        let leftDueDate = leftCard.dueAt.flatMap(parseIsoTimestamp),
        let rightDueDate = rightCard.dueAt.flatMap(parseIsoTimestamp),
        leftDueDate != rightDueDate
    {
        return leftDueDate < rightDueDate
    }

    let leftCreatedAt = parseIsoTimestamp(value: leftCard.createdAt) ?? .distantFuture
    let rightCreatedAt = parseIsoTimestamp(value: rightCard.createdAt) ?? .distantFuture
    if leftCreatedAt != rightCreatedAt {
        return leftCreatedAt > rightCreatedAt
    }

    return leftCard.cardId < rightCard.cardId
}

func sortCardsForReviewQueue(cards: [Card], now: Date) -> [Card] {
    cards.filter { card in
        card.deletedAt == nil && isCardDue(card: card, now: now)
    }.sorted { leftCard, rightCard in
        compareCardsForReviewOrder(leftCard: leftCard, rightCard: rightCard, now: now)
    }
}

func sortCardsForReviewTimeline(cards: [Card], now: Date) -> [Card] {
    cards.filter { card in
        card.deletedAt == nil
    }.sorted { leftCard, rightCard in
        compareCardsForReviewOrder(leftCard: leftCard, rightCard: rightCard, now: now)
    }
}

func resolveReviewFilter(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> ReviewFilter {
    switch reviewFilter {
    case .allCards:
        return .allCards
    case .deck(let deckId):
        if decks.contains(where: { deck in
            deck.deckId == deckId
        }) {
            return reviewFilter
        }

        return .allCards
    case .tag(let tag):
        if hasActiveTag(tag: tag, cards: cards) {
            return reviewFilter
        }

        return .allCards
    }
}

func cardsMatchingReviewFilter(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> [Card] {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return deriveActiveCards(cards: cards)
    case .deck(let deckId):
        guard let deck = decks.first(where: { candidateDeck in
            candidateDeck.deckId == deckId
        }) else {
            return []
        }

        return cardsMatchingDeck(deck: deck, cards: cards)
    case .tag(let tag):
        return deriveActiveCards(cards: cards).filter { card in
            card.tags.contains(tag)
        }
    }
}

func reviewFilterTitle(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> String {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return allCardsDeckLabel
    case .deck(let deckId):
        guard let deck = decks.first(where: { candidateDeck in
            candidateDeck.deckId == deckId
        }) else {
            return allCardsDeckLabel
        }

        return deck.name
    case .tag(let tag):
        return tag
    }
}

func shouldShowSwitchToAllCardsReviewAction(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> Bool {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return false
    case .deck, .tag:
        return true
    }
}

func makeReviewQueue(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card], now: Date) -> [Card] {
    sortCardsForReviewQueue(
        cards: cardsMatchingReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards),
        now: now
    )
}

private func insertReviewQueueCandidate(
    card: Card,
    currentTopCards: [Card],
    now: Date,
    limit: Int
) -> [Card] {
    let insertionIndex = currentTopCards.firstIndex { existingCard in
        compareCardsForReviewOrder(leftCard: card, rightCard: existingCard, now: now)
    } ?? currentTopCards.count
    var updatedTopCards = currentTopCards
    updatedTopCards.insert(card, at: insertionIndex)

    return Array(updatedTopCards.prefix(limit))
}

func resolveReviewQuery(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> ResolvedReviewQuery {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return ResolvedReviewQuery(
            reviewFilter: resolvedReviewFilter,
            queryDefinition: .allCards
        )
    case .deck(let deckId):
        guard let deck = decks.first(where: { candidateDeck in
            candidateDeck.deckId == deckId
        }) else {
            return ResolvedReviewQuery(
                reviewFilter: .allCards,
                queryDefinition: .allCards
            )
        }

        return ResolvedReviewQuery(
            reviewFilter: resolvedReviewFilter,
            queryDefinition: .deck(filterDefinition: deck.filterDefinition)
        )
    case .tag(let tag):
        return ResolvedReviewQuery(
            reviewFilter: resolvedReviewFilter,
            queryDefinition: .tag(tag: tag)
        )
    }
}

func makeReviewCounts(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date
) -> ReviewCounts {
    let matchingCards = cardsMatchingReviewFilter(
        reviewFilter: reviewFilter,
        decks: decks,
        cards: cards
    )

    return matchingCards.reduce(
        into: ReviewCounts(dueCount: 0, totalCount: 0)
    ) { result, card in
        guard card.deletedAt == nil else {
            return
        }

        result = ReviewCounts(
            dueCount: result.dueCount + (isCardDue(card: card, now: now) ? 1 : 0),
            totalCount: result.totalCount + 1
        )
    }
}

func makeReviewQueueChunkLoadState(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date,
    limit: Int,
    excludedCardIds: Set<String>
) -> ReviewQueueChunkLoadState {
    precondition(limit > 0, "Review seed queue limit must be greater than zero")

    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)
    let matchingCards = cardsMatchingReviewFilter(
        reviewFilter: resolvedReviewFilter,
        decks: decks,
        cards: cards
    )

    let candidateLimit = limit + 1
    let topCards = matchingCards.reduce(into: [Card]()) { result, card in
        guard excludedCardIds.contains(card.cardId) == false else {
            return
        }
        guard card.deletedAt == nil && isCardDue(card: card, now: now) else {
            return
        }

        if result.count < candidateLimit {
            result = insertReviewQueueCandidate(
                card: card,
                currentTopCards: result,
                now: now,
                limit: candidateLimit
            )
            return
        }

        guard let lastCard = result.last else {
            return
        }
        guard compareCardsForReviewOrder(leftCard: card, rightCard: lastCard, now: now) else {
            return
        }

        result = insertReviewQueueCandidate(
            card: card,
            currentTopCards: result,
            now: now,
            limit: candidateLimit
        )
    }

    return ReviewQueueChunkLoadState(
        reviewQueueChunk: Array(topCards.prefix(limit)),
        hasMoreCards: topCards.count > limit
    )
}

func makeReviewHeadLoadState(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date,
    seedQueueSize: Int
) -> ReviewHeadLoadState {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)
    let queueChunkLoadState = makeReviewQueueChunkLoadState(
        reviewFilter: resolvedReviewFilter,
        decks: decks,
        cards: cards,
        now: now,
        limit: seedQueueSize,
        excludedCardIds: []
    )

    return ReviewHeadLoadState(
        resolvedReviewFilter: resolvedReviewFilter,
        seedReviewQueue: queueChunkLoadState.reviewQueueChunk,
        hasMoreCards: queueChunkLoadState.hasMoreCards
    )
}

func makeReviewSessionSignature(
    selectedReviewFilter: ReviewFilter,
    reviewQueue: [Card],
    schedulerSettings: WorkspaceSchedulerSettings?,
    seedQueueSize: Int
) -> ReviewSessionSignature {
    let seedQueue = Array(reviewQueue.prefix(seedQueueSize)).map { card in
        ReviewSessionCardSignature(
            cardId: card.cardId,
            updatedAt: card.updatedAt
        )
    }

    return ReviewSessionSignature(
        selectedReviewFilter: selectedReviewFilter,
        seedQueue: seedQueue,
        schedulerSettingsUpdatedAt: schedulerSettings?.updatedAt ?? "no-scheduler-settings"
    )
}

func makeReviewTimeline(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card], now: Date) -> [Card] {
    sortCardsForReviewTimeline(
        cards: cardsMatchingReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards),
        now: now
    )
}

func currentReviewCard(reviewQueue: [Card]) -> Card? {
    reviewQueue.first
}

func nextReviewCard(reviewQueue: [Card]) -> Card? {
    reviewQueue.dropFirst().first
}
