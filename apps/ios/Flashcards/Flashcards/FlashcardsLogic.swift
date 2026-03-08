import Foundation

private let goodIntervalsDays: [Int] = [1, 3, 7, 14, 30, 60]
private let easyIntervalsDays: [Int] = [3, 7, 14, 30, 60, 90]

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

func tagSuggestions(cards: [Card]) -> [String] {
    let counts = cards.reduce(into: [String: Int]()) { result, card in
        for tag in normalizeTags(values: card.tags, referenceTags: []) {
            result[tag, default: 0] += 1
        }
    }

    return counts.keys.sorted { leftTag, rightTag in
        let leftCount = counts[leftTag] ?? 0
        let rightCount = counts[rightTag] ?? 0
        if leftCount != rightCount {
            return leftCount > rightCount
        }

        return leftTag.localizedCaseInsensitiveCompare(rightTag) == .orderedAscending
    }
}

func filterTagSuggestions(suggestions: [String], selectedTags: [String], searchText: String) -> [String] {
    let selectedTagKeys = Set(selectedTags.map { tag in
        normalizeTagKey(tag: tag)
    })
    let normalizedSearchText = normalizeTag(rawValue: searchText).lowercased()

    return normalizeTags(values: suggestions, referenceTags: []).filter { suggestion in
        if selectedTagKeys.contains(normalizeTagKey(tag: suggestion)) {
            return false
        }

        if normalizedSearchText.isEmpty {
            return true
        }

        return suggestion.lowercased().contains(normalizedSearchText)
    }
}

func creatableTagValue(searchText: String, selectedTags: [String], suggestions: [String]) -> String? {
    let normalizedSearchText = normalizeTag(rawValue: searchText)
    if normalizedSearchText.isEmpty {
        return nil
    }

    let normalizedSearchKey = normalizeTagKey(tag: normalizedSearchText)
    let existingTags = selectedTags + suggestions
    if existingTags.contains(where: { tag in
        normalizeTagKey(tag: tag) == normalizedSearchKey
    }) {
        return nil
    }

    return normalizedSearchText
}

func toggleTagSelection(selectedTags: [String], tag: String, suggestions: [String]) -> [String] {
    let tagKey = normalizeTagKey(tag: tag)
    if selectedTags.contains(where: { selectedTag in
        normalizeTagKey(tag: selectedTag) == tagKey
    }) {
        return selectedTags.filter { selectedTag in
            normalizeTagKey(tag: selectedTag) != tagKey
        }
    }

    return normalizeTags(values: selectedTags + [tag], referenceTags: suggestions)
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

func addMinutes(date: Date, minutes: Int) -> Date {
    Date(timeInterval: TimeInterval(minutes * 60), since: date)
}

func addHours(date: Date, hours: Int) -> Date {
    Date(timeInterval: TimeInterval(hours * 3_600), since: date)
}

func addDays(date: Date, days: Int) -> Date {
    Date(timeInterval: TimeInterval(days * 86_400), since: date)
}

func intervalDays(intervals: [Int], reps: Int) -> Int {
    let clampedIndex = max(0, min(reps - 1, intervals.count - 1))
    return intervals[clampedIndex]
}

func computeReviewSchedule(currentReps: Int, currentLapses: Int, rating: ReviewRating, now: Date) -> ReviewSchedule {
    switch rating {
    case .again:
        return ReviewSchedule(
            dueAt: addMinutes(date: now, minutes: 10),
            reps: currentReps,
            lapses: currentLapses + 1
        )
    case .hard:
        return ReviewSchedule(
            dueAt: addHours(date: now, hours: 12),
            reps: currentReps,
            lapses: currentLapses
        )
    case .good:
        let reps = currentReps + 1
        return ReviewSchedule(
            dueAt: addDays(date: now, days: intervalDays(intervals: goodIntervalsDays, reps: reps)),
            reps: reps,
            lapses: currentLapses
        )
    case .easy:
        let reps = currentReps + 1
        return ReviewSchedule(
            dueAt: addDays(date: now, days: intervalDays(intervals: easyIntervalsDays, reps: reps)),
            reps: reps,
            lapses: currentLapses
        )
    }
}

func isCardDue(card: Card, now: Date) -> Bool {
    guard let dueAt = card.dueAt else {
        return true
    }

    guard let dueDate = parseIsoTimestamp(value: dueAt) else {
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

func evaluateDeckPredicate(predicate: DeckPredicate, card: Card) -> Bool {
    switch predicate {
    case .effortLevel(let values):
        return values.contains(card.effortLevel)
    case .tags(let operatorName, let values):
        let cardTags = Set(card.tags)
        let predicateTags = Set(values)

        switch operatorName {
        case .containsAny:
            return predicateTags.isDisjoint(with: cardTags) == false
        case .containsAll:
            return predicateTags.isSubset(of: cardTags)
        }
    }
}

func matchesDeckFilterDefinition(filterDefinition: DeckFilterDefinition, card: Card) -> Bool {
    if filterDefinition.predicates.isEmpty {
        return true
    }

    let evaluations = filterDefinition.predicates.map { predicate in
        evaluateDeckPredicate(predicate: predicate, card: card)
    }

    switch filterDefinition.combineWith {
    case .and:
        return evaluations.allSatisfy { value in
            value
        }
    case .or:
        return evaluations.contains(true)
    }
}

func formatDeckPredicate(predicate: DeckPredicate) -> String {
    switch predicate {
    case .effortLevel(let values):
        return "effort in \(values.map { value in value.rawValue }.joined(separator: ", "))"
    case .tags(let operatorName, let values):
        let operatorLabel = operatorName == .containsAll ? "contains all" : "contains any"
        return "tags \(operatorLabel) \(values.joined(separator: ", "))"
    }
}

func formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition) -> String {
    if filterDefinition.predicates.isEmpty {
        return "All cards"
    }

    let joinLabel = filterDefinition.combineWith == .or ? " OR " : " AND "
    return filterDefinition.predicates.map { predicate in
        formatDeckPredicate(predicate: predicate)
    }.joined(separator: joinLabel)
}

func buildDeckFilterDefinition(
    effortLevels: [EffortLevel],
    combineWith: DeckCombineOperator,
    tagsOperator: DeckTagsOperator,
    tags: [String]
) -> DeckFilterDefinition {
    var predicates: [DeckPredicate] = []

    if effortLevels.isEmpty == false {
        predicates.append(.effortLevel(values: effortLevels))
    }

    if tags.isEmpty == false {
        predicates.append(.tags(operatorName: tagsOperator, values: tags))
    }

    return DeckFilterDefinition(
        version: 1,
        combineWith: combineWith,
        predicates: predicates
    )
}

func sortCardsForReviewQueue(cards: [Card], now: Date) -> [Card] {
    cards.filter { card in
        card.deletedAt == nil && isCardDue(card: card, now: now)
    }.sorted { leftCard, rightCard in
        switch (leftCard.dueAt, rightCard.dueAt) {
        case (nil, nil):
            return leftCard.updatedAt > rightCard.updatedAt
        case (nil, _?):
            return true
        case (_?, nil):
            return false
        case let (.some(leftDueAt), .some(rightDueAt)):
            if leftDueAt != rightDueAt {
                return leftDueAt < rightDueAt
            }

            return leftCard.updatedAt > rightCard.updatedAt
        }
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

func resolveReviewFilter(reviewFilter: ReviewFilter, decks: [Deck]) -> ReviewFilter {
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
    }
}

func cardsMatchingReviewFilter(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card]) -> [Card] {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks)

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
    }
}

func reviewFilterTitle(reviewFilter: ReviewFilter, decks: [Deck]) -> String {
    let resolvedReviewFilter = resolveReviewFilter(reviewFilter: reviewFilter, decks: decks)

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
    }
}

func makeReviewQueue(reviewFilter: ReviewFilter, decks: [Deck], cards: [Card], now: Date) -> [Card] {
    sortCardsForReviewQueue(
        cards: cardsMatchingReviewFilter(reviewFilter: reviewFilter, decks: decks, cards: cards),
        now: now
    )
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

func localizedMessage(error: Error) -> String {
    if let localizedError = error as? LocalizedError, let description = localizedError.errorDescription {
        return description
    }

    return String(describing: error)
}
