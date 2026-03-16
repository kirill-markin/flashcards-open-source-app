import Foundation

private let maximumSearchTokenCount = 5

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

func searchCards(cards: [Card], searchText: String) -> [Card] {
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

func queryCards(cards: [Card], searchText: String, filter: CardFilter?) -> [Card] {
    let filteredCards: [Card]
    if let filter {
        filteredCards = cards.filter { card in
            matchesCardFilter(filter: filter, card: card)
        }
    } else {
        filteredCards = cards
    }

    return searchCards(cards: filteredCards, searchText: searchText)
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

func deriveActiveCards(cards: [Card]) -> [Card] {
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
    let activeCards = deriveActiveCards(cards: cards)

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

func cardsMatchingDeck(deck: Deck, cards: [Card]) -> [Card] {
    deriveActiveCards(cards: cards).filter { card in
        matchesDeckFilterDefinition(filterDefinition: deck.filterDefinition, card: card)
    }
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
            cards: cardsMatchingDeck(deck: deck, cards: cards),
            now: now
        )
    }
}
