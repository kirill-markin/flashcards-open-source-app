import Foundation

let recentDuePriorityWindow: TimeInterval = 60 * 60

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

struct ReviewQueueWindowLoadState: Hashable, Sendable {
    let reviewQueue: [Card]
    let hasMoreCards: Bool
}

enum ReviewOrderBucket: Int, Hashable, Sendable {
    case recentDue = 0
    case oldDue = 1
    case new = 2
    case future = 3
    case malformed = 4
}

struct ReviewOrderRank: Hashable, Sendable {
    let bucket: ReviewOrderBucket
    let dueAt: Date?
}

func makeReviewOrderRank(card: Card, now: Date) -> ReviewOrderRank {
    guard let dueAt = card.dueAt else {
        return ReviewOrderRank(bucket: .new, dueAt: nil)
    }

    guard let dueDate = parseIsoTimestamp(value: dueAt) else {
        return ReviewOrderRank(bucket: .malformed, dueAt: nil)
    }

    if dueDate > now {
        return ReviewOrderRank(bucket: .future, dueAt: dueDate)
    }

    let recentCutoff = now.addingTimeInterval(-recentDuePriorityWindow)
    if dueDate >= recentCutoff {
        return ReviewOrderRank(bucket: .recentDue, dueAt: dueDate)
    }

    return ReviewOrderRank(bucket: .oldDue, dueAt: dueDate)
}

func isActiveReviewOrderBucket(bucket: ReviewOrderBucket) -> Bool {
    switch bucket {
    case .recentDue, .oldDue, .new:
        return true
    case .future, .malformed:
        return false
    }
}

private func activeTagNames(cards: [Card]) -> [String] {
    deriveActiveCards(cards: cards).flatMap(\.tags)
}

// Keep review queue ordering aligned with:
// - apps/ios/Flashcards/Flashcards/Database/CardStore+ReadSQL.swift review queue ORDER BY
// - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt::sortCardsForReviewQueue
// - apps/web/src/appData/domain.ts::compareCardsForReviewOrder
// Ordering contract: recent due cards within the inclusive one-hour window first, then older due cards,
// then nil dueAt new cards, then future cards, then malformed dueAt values last.
// If this changes, mirror the same change across all three clients in the same change.
func compareCardsForReviewOrder(leftCard: Card, rightCard: Card, now: Date) -> Bool {
    let leftRank = makeReviewOrderRank(card: leftCard, now: now)
    let rightRank = makeReviewOrderRank(card: rightCard, now: now)
    if leftRank.bucket != rightRank.bucket {
        return leftRank.bucket.rawValue < rightRank.bucket.rawValue
    }

    if
        let leftDueDate = leftRank.dueAt,
        let rightDueDate = rightRank.dueAt,
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
        card.deletedAt == nil && isActiveReviewOrderBucket(bucket: makeReviewOrderRank(card: card, now: now).bucket)
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
    resolveReviewFilter(
        reviewFilter: reviewFilter,
        decks: decks,
        storedTagNames: activeTagNames(cards: cards)
    )
}

func resolveReviewFilter(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    storedTagNames: [String]
) -> ReviewFilter {
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
    case .effort:
        return reviewFilter
    case .tag(let tag):
        if let exactTagName = resolveExactStoredTagNames(
            requestedTagNames: [tag],
            storedTagNames: storedTagNames
        ).first {
            return .tag(tag: exactTagName)
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
    case .effort(let level):
        return deriveActiveCards(cards: cards).filter { card in
            card.effortLevel == level
        }
    case .tag(let tag):
        return deriveActiveCards(cards: cards).filter { card in
            hasTagMatchingRequest(storedTagNames: card.tags, requestedTagName: tag)
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
    case .effort(let level):
        return level.title
    case .tag(let tag):
        return tag
    }
}

func shouldShowSwitchToAllCardsReviewAction(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> Bool {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return false
    case .deck, .effort, .tag:
        return true
    }
}

func makeReviewQueue(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card], now: Date) -> [Card] {
    sortCardsForReviewQueue(
        cards: cardsMatchingReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards),
        now: now
    )
}

private func cardMatchesResolvedReviewFilter(reviewFilter: ReviewFilter, decks: [Deck], card: Card) -> Bool {
    guard card.deletedAt == nil else {
        return false
    }

    switch reviewFilter {
    case .allCards:
        return true
    case .deck(let deckId):
        guard let deck = decks.first(where: { candidateDeck in
            candidateDeck.deckId == deckId
        }) else {
            return false
        }

        return matchesDeckFilterDefinition(filterDefinition: deck.filterDefinition, card: card)
    case .effort(let level):
        return card.effortLevel == level
    case .tag(let tag):
        return hasTagMatchingRequest(storedTagNames: card.tags, requestedTagName: tag)
    }
}

func presentedReviewCardForBackgroundRefresh(
    reviewQueue: [Card],
    presentedCardId: String?,
    pendingReviewCardIds: Set<String>,
    resolvedReviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date
) -> Card? {
    guard let presentedCardId else {
        return nil
    }
    guard pendingReviewCardIds.contains(presentedCardId) == false else {
        return nil
    }
    if let canonicalPresentedCard = reviewQueue.first(where: { card in
        card.cardId == presentedCardId
    }) {
        return canonicalPresentedCard
    }
    guard let presentedCard = cards.first(where: { card in
        card.cardId == presentedCardId
    }) else {
        return nil
    }
    guard cardMatchesResolvedReviewFilter(reviewFilter: resolvedReviewFilter, decks: decks, card: presentedCard) else {
        return nil
    }
    guard isActiveReviewOrderBucket(bucket: makeReviewOrderRank(card: presentedCard, now: now).bucket) else {
        return nil
    }

    return presentedCard
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

func resolveTagReviewQuery(requestedTag: String, storedTagNames: [String]) -> ResolvedReviewQuery? {
    let exactTagNames = resolveExactStoredTagNames(
        requestedTagNames: [requestedTag],
        storedTagNames: storedTagNames
    )
    guard let displayTagName = exactTagNames.first else {
        return nil
    }

    return ResolvedReviewQuery(
        reviewFilter: .tag(tag: displayTagName),
        queryDefinition: .tag(exactTagNames: exactTagNames)
    )
}

func resolveReviewQuery(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> ResolvedReviewQuery {
    resolveReviewQuery(
        reviewFilter: reviewFilter,
        decks: decks,
        storedTagNames: activeTagNames(cards: cards)
    )
}

func resolveReviewQuery(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    storedTagNames: [String]
) -> ResolvedReviewQuery {
    let resolvedReviewFilter = resolveReviewFilter(
        reviewFilter: reviewFilter,
        decks: decks,
        storedTagNames: storedTagNames
    )

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
            queryDefinition: .deck(
                filterDefinition: resolveDeckFilterDefinitionTagNames(
                    filterDefinition: deck.filterDefinition,
                    storedTagNames: storedTagNames
                )
            )
        )
    case .effort(let level):
        return ResolvedReviewQuery(
            reviewFilter: resolvedReviewFilter,
            queryDefinition: .deck(
                filterDefinition: buildDeckFilterDefinition(
                    effortLevels: [level],
                    tags: []
                )
            )
        )
    case .tag(let tag):
        return resolveTagReviewQuery(
            requestedTag: tag,
            storedTagNames: storedTagNames
        ) ?? ResolvedReviewQuery(
            reviewFilter: .allCards,
            queryDefinition: .allCards
        )
    }
}

func makeReviewSubmissionContext(
    selectedReviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card]
) -> ReviewSubmissionContext {
    let resolvedReviewQuery = resolveReviewQuery(
        reviewFilter: selectedReviewFilter,
        decks: decks,
        cards: cards
    )

    return ReviewSubmissionContext(
        selectedReviewFilter: resolvedReviewQuery.reviewFilter,
        reviewQueryDefinition: resolvedReviewQuery.queryDefinition
    )
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
        guard card.deletedAt == nil else {
            return
        }
        guard isActiveReviewOrderBucket(bucket: makeReviewOrderRank(card: card, now: now).bucket) else {
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
