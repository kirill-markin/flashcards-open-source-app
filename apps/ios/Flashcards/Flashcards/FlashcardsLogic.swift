import Foundation
import OSLog

func logFlashcardsError(domain: String, action: String, metadata: [String: String]) {
    var logRecord = metadata
    logRecord["domain"] = domain
    logRecord["action"] = action

    guard JSONSerialization.isValidJSONObject(logRecord),
          let data = try? JSONSerialization.data(withJSONObject: logRecord, options: []),
          let line = String(data: data, encoding: .utf8) else {
        fputs("{\"domain\":\"ios\",\"action\":\"log_serialization_failed\"}\n", stderr)
        return
    }

    fputs(line + "\n", stderr)
}

func isoTimestamp(date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func parseIsoTimestamp(value: String) -> Date? {
    let formatterWithFractionalSeconds = ISO8601DateFormatter()
    formatterWithFractionalSeconds.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatterWithFractionalSeconds.date(from: value) {
        return date
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

func currentIsoTimestamp() -> String {
    isoTimestamp(date: Date())
}

func normalizeTag(rawValue: String) -> String {
    rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
}

func normalizeTagKey(tag: String) -> String {
    normalizeTag(rawValue: tag).lowercased()
}

func canonicalTagValue(rawValue: String, referenceTags: [String]) -> String? {
    let normalizedValue = normalizeTag(rawValue: rawValue)
    if normalizedValue.isEmpty {
        return nil
    }

    let normalizedKey = normalizeTagKey(tag: normalizedValue)
    if let matchingReferenceTag = referenceTags.first(where: { referenceTag in
        normalizeTagKey(tag: referenceTag) == normalizedKey
    }) {
        return normalizeTag(rawValue: matchingReferenceTag)
    }

    return normalizedValue
}

func normalizeTags(values: [String], referenceTags: [String]) -> [String] {
    values.reduce(into: [String]()) { result, value in
        guard let canonicalValue = canonicalTagValue(rawValue: value, referenceTags: referenceTags + result) else {
            return
        }

        let canonicalKey = normalizeTagKey(tag: canonicalValue)
        if result.contains(where: { existingValue in
            normalizeTagKey(tag: existingValue) == canonicalKey
        }) {
            return
        }

        result.append(canonicalValue)
    }
}

private func tagSuggestionReferenceTags(suggestions: [TagSuggestion]) -> [String] {
    suggestions.map(\.tag)
}

private func makeTagSuggestionsIndex(suggestions: [TagSuggestion]) -> [String: TagSuggestion] {
    suggestions.reduce(into: [String: TagSuggestion]()) { result, suggestion in
        result[normalizeTagKey(tag: suggestion.tag)] = suggestion
    }
}

private func compareTagSuggestions(left: TagSuggestion, right: TagSuggestion) -> Bool {
    switch (left.countState, right.countState) {
    case (.ready(let leftCount), .ready(let rightCount)):
        if leftCount != rightCount {
            return leftCount > rightCount
        }
    case (.ready, .loading):
        return true
    case (.loading, .ready):
        return false
    case (.loading, .loading):
        break
    }

    return left.tag.localizedCaseInsensitiveCompare(right.tag) == .orderedAscending
}

func normalizeTagSuggestions(suggestions: [TagSuggestion]) -> [TagSuggestion] {
    suggestions.reduce(into: [TagSuggestion]()) { result, suggestion in
        guard let canonicalTag = canonicalTagValue(
            rawValue: suggestion.tag,
            referenceTags: tagSuggestionReferenceTags(suggestions: result)
        ) else {
            return
        }

        let nextSuggestion = TagSuggestion(
            tag: canonicalTag,
            countState: suggestion.countState
        )
        let canonicalKey = normalizeTagKey(tag: canonicalTag)
        if let existingIndex = result.firstIndex(where: { existingSuggestion in
            normalizeTagKey(tag: existingSuggestion.tag) == canonicalKey
        }) {
            switch (result[existingIndex].countState, nextSuggestion.countState) {
            case (.loading, .ready):
                result[existingIndex] = nextSuggestion
            case (.ready(let existingCount), .ready(let nextCount)):
                if nextCount > existingCount {
                    result[existingIndex] = nextSuggestion
                }
            case (.ready, .loading), (.loading, .loading):
                break
            }

            return
        }

        result.append(nextSuggestion)
    }.sorted(by: compareTagSuggestions)
}

func tagSuggestions(cards: [Card]) -> [TagSuggestion] {
    let activeCards = cards.filter { card in
        card.deletedAt == nil
    }
    let counts = activeCards.reduce(into: [String: Int]()) { result, card in
        for tag in normalizeTags(values: card.tags, referenceTags: []) {
            result[tag, default: 0] += 1
        }
    }

    return counts.map { entry in
        TagSuggestion(
            tag: entry.key,
            countState: .ready(cardsCount: entry.value)
        )
    }.sorted(by: compareTagSuggestions)
}

func workspaceTagsSummary(cards: [Card]) -> WorkspaceTagsSummary {
    let activeCards = cards.filter { card in
        card.deletedAt == nil
    }
    let counts = activeCards.reduce(into: [String: Int]()) { result, card in
        for tag in card.tags {
            result[tag, default: 0] += 1
        }
    }
    let tags = counts.map { entry in
        WorkspaceTagSummary(tag: entry.key, cardsCount: entry.value)
    }.sorted { leftTag, rightTag in
        if leftTag.cardsCount != rightTag.cardsCount {
            return leftTag.cardsCount > rightTag.cardsCount
        }

        return leftTag.tag.localizedCaseInsensitiveCompare(rightTag.tag) == .orderedAscending
    }

    return WorkspaceTagsSummary(tags: tags, totalCards: activeCards.count)
}

func filterTagSuggestions(suggestions: [TagSuggestion], selectedTags: [String], searchText: String) -> [TagSuggestion] {
    let selectedTagKeys = Set(selectedTags.map { tag in
        normalizeTagKey(tag: tag)
    })
    let normalizedSearchText = normalizeTag(rawValue: searchText).lowercased()

    return suggestions.filter { suggestion in
        if selectedTagKeys.contains(normalizeTagKey(tag: suggestion.tag)) {
            return false
        }

        if normalizedSearchText.isEmpty {
            return true
        }

        return suggestion.tag.lowercased().contains(normalizedSearchText)
    }
}

func selectedTagSuggestions(selectedTags: [String], suggestions: [TagSuggestion]) -> [TagSuggestion] {
    let referenceTags = tagSuggestionReferenceTags(suggestions: suggestions)
    let suggestionsIndex = makeTagSuggestionsIndex(suggestions: suggestions)

    return normalizeTags(values: selectedTags, referenceTags: referenceTags).map { tag in
        if let existingSuggestion = suggestionsIndex[normalizeTagKey(tag: tag)] {
            return existingSuggestion
        }

        return TagSuggestion(
            tag: tag,
            countState: .ready(cardsCount: 0)
        )
    }.sorted(by: compareTagSuggestions)
}

func creatableTagValue(searchText: String, selectedTags: [String], suggestions: [TagSuggestion]) -> String? {
    let normalizedSearchText = normalizeTag(rawValue: searchText)
    if normalizedSearchText.isEmpty {
        return nil
    }

    let normalizedSearchKey = normalizeTagKey(tag: normalizedSearchText)
    let existingTags = selectedTags + tagSuggestionReferenceTags(suggestions: suggestions)
    if existingTags.contains(where: { tag in
        normalizeTagKey(tag: tag) == normalizedSearchKey
    }) {
        return nil
    }

    return normalizedSearchText
}

func toggleTagSelection(selectedTags: [String], tag: String, suggestions: [TagSuggestion]) -> [String] {
    let tagKey = normalizeTagKey(tag: tag)
    if selectedTags.contains(where: { selectedTag in
        normalizeTagKey(tag: selectedTag) == tagKey
    }) {
        return selectedTags.filter { selectedTag in
            normalizeTagKey(tag: selectedTag) != tagKey
        }
    }

    return normalizeTags(
        values: selectedTags + [tag],
        referenceTags: tagSuggestionReferenceTags(suggestions: suggestions)
    )
}

func formatTagSelectionSummary(tags: [String]) -> String {
    if tags.isEmpty {
        return "No tags"
    }

    if tags.count <= 2 {
        return tags.joined(separator: ", ")
    }

    return "\(tags[0]), \(tags[1]) +\(tags.count - 2)"
}

func formatTags(tags: [String]) -> String {
    tags.joined(separator: ", ")
}

let maximumSearchTokenCount = 5

// Keep in sync with apps/backend/src/searchTokens.ts::tokenizeSearchText.
func tokenizeSearchText(searchText: String) -> [String] {
    let normalizedSearchText = searchText
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
    if normalizedSearchText.isEmpty {
        return []
    }

    let tokens = normalizedSearchText
        .split(whereSeparator: { character in
            character.isWhitespace
        })
        .map(String.init)
    if tokens.count <= maximumSearchTokenCount {
        return tokens
    }

    return Array(tokens.prefix(maximumSearchTokenCount - 1))
        + [tokens.dropFirst(maximumSearchTokenCount - 1).joined(separator: " ")]
}

func matchesAnySearchToken(values: [String], searchTokens: [String]) -> Bool {
    let normalizedValues = values.map { value in
        value.lowercased()
    }

    return searchTokens.contains { token in
        normalizedValues.contains { value in
            value.contains(token)
        }
    }
}

func matchesAllSearchTokens(values: [String], searchTokens: [String]) -> Bool {
    let normalizedValues = values.map { value in
        value.lowercased()
    }

    return searchTokens.allSatisfy { token in
        normalizedValues.contains { value in
            value.contains(token)
        }
    }
}

func cardsMatchingSearchText(cards: [Card], searchText: String) -> [Card] {
    let searchTokens = tokenizeSearchText(searchText: searchText)
    if searchTokens.isEmpty {
        return cards
    }

    return cards.filter { card in
        matchesAllSearchTokens(
            values: [card.frontText, card.backText] + card.tags + [card.effortLevel.rawValue],
            searchTokens: searchTokens
        )
    }
}

func addMinutes(date: Date, minutes: Int) -> Date {
    Date(timeInterval: TimeInterval(minutes * 60), since: date)
}

func addDays(date: Date, days: Int) -> Date {
    Date(timeInterval: TimeInterval(days * 86_400), since: date)
}

func isCardDue(card: Card, now: Date) -> Bool {
    guard let dueAt = card.dueAt else {
        return true
    }

    guard let dueDate = parseIsoTimestamp(value: dueAt) else {
        logFlashcardsError(
            domain: "cards",
            action: "invalid_due_at",
            metadata: [
                "cardId": card.cardId,
                "dueAt": dueAt
            ]
        )
        return false
    }

    return dueDate <= now
}

func isCardNew(card: Card) -> Bool {
    card.reps == 0 && card.lapses == 0
}

func isCardReviewed(card: Card) -> Bool {
    card.reps > 0 || card.lapses > 0
}

func matchesDeckFilterDefinition(filterDefinition: DeckFilterDefinition, card: Card) -> Bool {
    if filterDefinition.effortLevels.isEmpty == false && filterDefinition.effortLevels.contains(card.effortLevel) == false {
        return false
    }

    if filterDefinition.tags.isEmpty {
        return true
    }

    let cardTags = Set(card.tags)
    return filterDefinition.tags.contains { tag in
        cardTags.contains(tag)
    }
}

func matchesCardFilter(filter: CardFilter, card: Card) -> Bool {
    if filter.effort.isEmpty == false && filter.effort.contains(card.effortLevel) == false {
        return false
    }

    if filter.tags.isEmpty {
        return true
    }

    let cardTags = Set(card.tags)
    return filter.tags.contains { tag in
        cardTags.contains(tag)
    }
}

func buildCardFilter(tags: [String], effort: [EffortLevel], referenceTags: [String]) -> CardFilter? {
    let normalizedTags = normalizeTags(values: tags, referenceTags: referenceTags)
    let normalizedEffort = effort.reduce(into: [EffortLevel]()) { result, effortLevel in
        if result.contains(effortLevel) {
            return
        }

        result.append(effortLevel)
    }

    if normalizedTags.isEmpty && normalizedEffort.isEmpty {
        return nil
    }

    return CardFilter(tags: normalizedTags, effort: normalizedEffort)
}

func cardFilterActiveDimensionCount(filter: CardFilter?) -> Int {
    guard let filter else {
        return 0
    }

    return (filter.effort.isEmpty == false ? 1 : 0) + (filter.tags.isEmpty == false ? 1 : 0)
}

func formatCardFilterSummary(filter: CardFilter?) -> String {
    guard let filter else {
        return "No filters"
    }

    var parts: [String] = []
    if filter.effort.isEmpty == false {
        parts.append("effort in \(filter.effort.map(\.rawValue).joined(separator: ", "))")
    }

    if filter.tags.isEmpty == false {
        parts.append("tags any of \(filter.tags.joined(separator: ", "))")
    }

    if parts.isEmpty {
        return "No filters"
    }

    return parts.joined(separator: " AND ")
}

func cardsMatchingSearchTextAndFilter(cards: [Card], searchText: String, filter: CardFilter?) -> [Card] {
    let filteredCards: [Card]
    if let filter {
        filteredCards = cards.filter { card in
            matchesCardFilter(filter: filter, card: card)
        }
    } else {
        filteredCards = cards
    }

    return cardsMatchingSearchText(cards: filteredCards, searchText: searchText)
}

func buildDeckFilterDefinition(
    effortLevels: [EffortLevel],
    tags: [String]
) -> DeckFilterDefinition {
    return DeckFilterDefinition(
        version: 2,
        effortLevels: effortLevels,
        tags: tags
    )
}

func formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition) -> String {
    var parts: [String] = []

    if filterDefinition.effortLevels.isEmpty == false {
        parts.append("effort in \(filterDefinition.effortLevels.map { value in value.rawValue }.joined(separator: ", "))")
    }

    if filterDefinition.tags.isEmpty == false {
        parts.append("tags any of \(filterDefinition.tags.joined(separator: ", "))")
    }

    if parts.isEmpty {
        return "All cards"
    }

    return parts.joined(separator: " AND ")
}

private func reviewOrderDueRank(card: Card) -> Int {
    guard let dueAt = card.dueAt else {
        return 0
    }

    guard parseIsoTimestamp(value: dueAt) != nil else {
        return 2
    }

    return 1
}

private func compareCardsForReviewOrder(leftCard: Card, rightCard: Card, now: Date) -> Bool {
    let leftIsDue = isCardDue(card: leftCard, now: now)
    let rightIsDue = isCardDue(card: rightCard, now: now)
    if leftIsDue != rightIsDue {
        return leftIsDue
    }

    let leftDueRank = reviewOrderDueRank(card: leftCard)
    let rightDueRank = reviewOrderDueRank(card: rightCard)
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

    return leftCard.updatedAt > rightCard.updatedAt
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

func activeCards(cards: [Card]) -> [Card] {
    cards.filter { card in
        card.deletedAt == nil
    }
}

func makeDeckCardStats(cards: [Card], now: Date) -> DeckCardStats {
    DeckCardStats(
        totalCards: cards.count,
        dueCards: cards.filter { card in
            isCardDue(card: card, now: now)
        }.count,
        newCards: cards.filter { card in
            isCardNew(card: card)
        }.count,
        reviewedCards: cards.filter { card in
            isCardReviewed(card: card)
        }.count
    )
}

func makeHomeSnapshot(cards: [Card], deckCount: Int, now: Date) -> HomeSnapshot {
    let activeCards = activeCards(cards: cards)

    return HomeSnapshot(
        deckCount: deckCount,
        totalCards: activeCards.count,
        dueCount: activeCards.filter { card in
            isCardDue(card: card, now: now)
        }.count,
        newCount: activeCards.filter { card in
            isCardNew(card: card)
        }.count,
        reviewedCount: activeCards.filter { card in
            isCardReviewed(card: card)
        }.count
    )
}

func matchingCardsForDeck(deck: Deck, cards: [Card]) -> [Card] {
    activeCards(cards: cards).filter { card in
        matchesDeckFilterDefinition(filterDefinition: deck.filterDefinition, card: card)
    }
}

private func hasActiveTag(tag: String, cards: [Card]) -> Bool {
    activeCards(cards: cards).contains { card in
        card.tags.contains(tag)
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
        return activeCards(cards: cards)
    case .deck(let deckId):
        guard let deck = decks.first(where: { candidateDeck in
            candidateDeck.deckId == deckId
        }) else {
            return []
        }

        return matchingCardsForDeck(deck: deck, cards: cards)
    case .tag(let tag):
        return activeCards(cards: cards).filter { card in
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

struct ResolvedReviewQuery: Hashable, Sendable {
    let reviewFilter: ReviewFilter
    let queryDefinition: ReviewQueryDefinition
}

struct ReviewHeadLoadState: Hashable, Sendable {
    let resolvedReviewFilter: ReviewFilter
    let seedReviewQueue: [Card]
    let hasMoreCards: Bool
}

struct ReviewQueueChunkLoadState: Hashable, Sendable {
    let reviewQueueChunk: [Card]
    let hasMoreCards: Bool
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

func makeReviewTimeline(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card], now: Date) -> [Card] {
    sortCardsForReviewTimeline(
        cards: cardsMatchingReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards),
        now: now
    )
}

func currentReviewCard(reviewQueue: [Card]) -> Card? {
    return reviewQueue.first
}

func nextReviewCard(reviewQueue: [Card]) -> Card? {
    return reviewQueue.dropFirst().first
}

func makeDeckListItem(deck: Deck, cards: [Card], now: Date) -> DeckListItem {
    let stats = makeDeckCardStats(cards: cards, now: now)

    return DeckListItem(
        deck: deck,
        totalCards: stats.totalCards,
        dueCards: stats.dueCards,
        newCards: stats.newCards,
        reviewedCards: stats.reviewedCards
    )
}

func makeDeckListItems(decks: [Deck], cards: [Card], now: Date) -> [DeckListItem] {
    decks.map { deck in
        makeDeckListItem(
            deck: deck,
            cards: matchingCardsForDeck(deck: deck, cards: cards),
            now: now
        )
    }
}

func displayTimestamp(value: String?) -> String {
    guard let value else {
        return "new"
    }

    guard let date = parseIsoTimestamp(value: value) else {
        return value
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}

let reviewAnswerPresentationOrder: [ReviewRating] = [.easy, .good, .hard, .again]

struct ReviewAnswerOption: Hashable, Identifiable {
    let rating: ReviewRating
    let intervalDescription: String

    var id: Int {
        rating.rawValue
    }
}

func formatReviewIntervalDescription(now: Date, dueAt: Date) -> String {
    let durationSeconds = max(Int(dueAt.timeIntervalSince(now)), 0)

    if durationSeconds < 60 {
        return "in less than a minute"
    }

    let durationMinutes = durationSeconds / 60
    if durationMinutes < 60 {
        return "in \(durationMinutes) minute\(durationMinutes == 1 ? "" : "s")"
    }

    let durationHours = durationMinutes / 60
    if durationHours < 24 {
        return "in \(durationHours) hour\(durationHours == 1 ? "" : "s")"
    }

    let durationDays = durationHours / 24
    return "in \(durationDays) day\(durationDays == 1 ? "" : "s")"
}

func makeReviewAnswerOptions(card: Card, schedulerSettings: WorkspaceSchedulerSettings, now: Date) throws -> [ReviewAnswerOption] {
    try reviewAnswerPresentationOrder.map { rating in
        let schedule = try computeReviewSchedule(
            card: card,
            settings: schedulerSettings,
            rating: rating,
            now: now
        )

        return ReviewAnswerOption(
            rating: rating,
            intervalDescription: formatReviewIntervalDescription(now: now, dueAt: schedule.dueAt)
        )
    }
}

func localizedMessage(error: Error) -> String {
    if let localizedError = error as? LocalizedError, let description = localizedError.errorDescription {
        return description
    }

    return String(describing: error)
}

enum CloudFlowPhase: String {
    case authSendCode = "auth_send_code"
    case authVerifyCode = "auth_verify_code"
    case workspaceList = "workspace_list"
    case workspaceCreate = "workspace_create"
    case workspaceSelect = "workspace_select"
    case linkLocalWorkspace = "link_local_workspace"
    case initialPush = "initial_push"
    case initialPull = "initial_pull"
    case linkedSync = "linked_sync"
}

private let cloudLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "flashcards-open-source-app",
    category: "cloud"
)

func logCloudPhase(
    phase: CloudFlowPhase,
    outcome: String,
    requestId: String? = nil,
    code: String? = nil,
    statusCode: Int? = nil,
    workspaceId: String? = nil,
    deviceId: String? = nil,
    selection: String? = nil,
    operationsCount: Int? = nil,
    changesCount: Int? = nil,
    errorMessage: String? = nil
) {
    cloudLogger.log(
        """
        phase=\(phase.rawValue, privacy: .public) \
        outcome=\(outcome, privacy: .public) \
        requestId=\(requestId ?? "-", privacy: .public) \
        code=\(code ?? "-", privacy: .public) \
        status=\(statusCode.map(String.init) ?? "-", privacy: .public) \
        workspaceId=\(workspaceId ?? "-", privacy: .public) \
        deviceId=\(deviceId ?? "-", privacy: .public) \
        selection=\(selection ?? "-", privacy: .public) \
        operations=\(operationsCount.map(String.init) ?? "-", privacy: .public) \
        changes=\(changesCount.map(String.init) ?? "-", privacy: .public) \
        error=\(errorMessage ?? "-", privacy: .public)
        """
    )
}

struct CloudApiErrorEnvelope: Decodable {
    let error: String?
    let requestId: String?
    let code: String?
}

struct CloudApiErrorDetails: Hashable {
    let message: String
    let requestId: String?
    let code: String?
}

func parseCloudApiErrorDetails(data: Data, requestId: String?) -> CloudApiErrorDetails {
    if let envelope = try? JSONDecoder().decode(CloudApiErrorEnvelope.self, from: data) {
        let message = envelope.error?.isEmpty == false
            ? envelope.error!
            : String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
        return CloudApiErrorDetails(
            message: message,
            requestId: envelope.requestId ?? requestId,
            code: envelope.code
        )
    }

    return CloudApiErrorDetails(
        message: String(data: data, encoding: .utf8) ?? "<non-utf8-body>",
        requestId: requestId,
        code: nil
    )
}

func appendCloudRequestReference(message: String, requestId: String?) -> String {
    guard let requestId, requestId.isEmpty == false else {
        return message
    }

    return "\(message) Reference: \(requestId)"
}
