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

    if isRecentlyReviewed(card: card, now: now) {
        return ReviewOrderRank(bucket: .recentDue, dueAt: dueDate)
    }

    return ReviewOrderRank(bucket: .oldDue, dueAt: dueDate)
}

private func isRecentlyReviewed(card: Card, now: Date) -> Bool {
    guard
        let fsrsLastReviewedAt = card.fsrsLastReviewedAt,
        let fsrsLastReviewedDate = parseIsoTimestamp(value: fsrsLastReviewedAt)
    else {
        return false
    }

    let recentCutoff = now.addingTimeInterval(-recentDuePriorityWindow)
    return fsrsLastReviewedDate >= recentCutoff && fsrsLastReviewedDate <= now
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

// Keep iOS in-memory review ordering aligned with:
// - apps/ios/Flashcards/Flashcards/Database/CardStore/CardStore+ReadSQL.swift review queue ORDER BY
// Ordering contract: recently reviewed due cards within the inclusive one-hour fsrsLastReviewedAt
// window first, then other due cards, then nil dueAt new cards, then future cards,
// then malformed dueAt values last. Cards in the same bucket and due-time position use
// older createdAt first.
// When this contract changes, coordinate matching review-order updates for supported clients.
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
        return leftCreatedAt < rightCreatedAt
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
    case .tags(let tags):
        return resolveTagsReviewQuery(
            requestedTags: tags,
            storedTagNames: storedTagNames
        ).reviewFilter
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
    case .tags(let tags):
        let selectedTagKeys = Set(tags.map(normalizeTagKey))
        return deriveActiveCards(cards: cards).filter { card in
            card.tags.contains { tag in
                selectedTagKeys.contains(normalizeTagKey(tag: tag))
            }
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
    case .tags(let tags):
        return localizedReviewTagsFilterTitle(tags: tags)
    }
}

func shouldShowSwitchToAllCardsReviewAction(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> Bool {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards)

    switch resolvedReviewFilter {
    case .allCards:
        return false
    case .deck, .tags:
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
    case .tags(let tags):
        let selectedTagKeys = Set(tags.map(normalizeTagKey))
        return card.tags.contains { tag in
            selectedTagKeys.contains(normalizeTagKey(tag: tag))
        }
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

func resolveTagsReviewQuery(requestedTags: [String], storedTagNames: [String]) -> ResolvedReviewQuery {
    let exactTagNames = resolveExactStoredTagNames(
        requestedTagNames: requestedTags,
        storedTagNames: storedTagNames
    )
    let selectedTagNames = resolveReviewTagNamesPreservingUnmatched(
        requestedTagNames: requestedTags,
        storedTagNames: storedTagNames
    )
    let currentTagKeys = Set(normalizedReviewTagNames(tags: storedTagNames).map(normalizeTagKey))
    let selectedTagKeys = Set(selectedTagNames.map(normalizeTagKey))
    let exactTagKeys = Set(exactTagNames.map(normalizeTagKey))
    if
        currentTagKeys.isEmpty == false,
        selectedTagKeys == exactTagKeys,
        exactTagKeys == currentTagKeys
    {
        return ResolvedReviewQuery(
            reviewFilter: .allCards,
            queryDefinition: .allCards
        )
    }

    return ResolvedReviewQuery(
        reviewFilter: .tags(tags: selectedTagNames),
        queryDefinition: .tag(exactTagNames: exactTagNames)
    )
}

func resolveReviewTagNamesPreservingUnmatched(
    requestedTagNames: [String],
    storedTagNames: [String]
) -> [String] {
    normalizedReviewTagNames(
        tags: normalizeTags(values: requestedTagNames, referenceTags: storedTagNames)
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
    case .tags(let tags):
        return resolveTagsReviewQuery(
            requestedTags: tags,
            storedTagNames: storedTagNames
        )
    }
}

func selectedReviewTagNames(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    storedTagNames: [String]
) -> [String] {
    switch reviewFilter {
    case .allCards:
        return normalizedReviewTagNames(tags: storedTagNames)
    case .deck(let deckId):
        guard let deck = decks.first(where: { deck in
            deck.deckId == deckId
        }) else {
            return []
        }

        return resolveReviewTagNamesPreservingUnmatched(
            requestedTagNames: deck.filterDefinition.tags,
            storedTagNames: storedTagNames
        )
    case .tags(let tags):
        return resolveReviewTagNamesPreservingUnmatched(
            requestedTagNames: tags,
            storedTagNames: storedTagNames
        )
    }
}

func reviewFilterByTogglingTag(
    reviewFilter: ReviewFilter,
    tag: String,
    decks: [Deck],
    storedTagNames: [String]
) -> ReviewFilter {
    let canonicalStoredTags = normalizedReviewTagNames(tags: storedTagNames)
    guard let canonicalTag = resolveExactStoredTagNames(
        requestedTagNames: [tag],
        storedTagNames: canonicalStoredTags
    ).first else {
        return reviewFilter
    }

    let selectedTags = selectedReviewTagNames(
        reviewFilter: reviewFilter,
        decks: decks,
        storedTagNames: canonicalStoredTags
    )
    let toggledTagKey = normalizeTagKey(tag: canonicalTag)
    let nextTags: [String]
    if selectedTags.contains(where: { selectedTag in
        normalizeTagKey(tag: selectedTag) == toggledTagKey
    }) {
        nextTags = selectedTags.filter { selectedTag in
            normalizeTagKey(tag: selectedTag) != toggledTagKey
        }
    } else {
        nextTags = normalizedReviewTagNames(tags: selectedTags + [canonicalTag])
    }

    return resolveTagsReviewQuery(
        requestedTags: nextTags,
        storedTagNames: canonicalStoredTags
    ).reviewFilter
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
