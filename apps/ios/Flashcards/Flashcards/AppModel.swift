import Foundation
import SQLite3

enum AppTab: Hashable {
    case review
    case decks
    case cards
    case settings
}

enum EffortLevel: String, CaseIterable, Codable, Hashable, Identifiable {
    case fast
    case medium
    case long

    var id: String {
        rawValue
    }

    var title: String {
        rawValue.capitalized
    }
}

enum ReviewRating: Int, CaseIterable, Hashable, Identifiable {
    case again = 0
    case hard = 1
    case good = 2
    case easy = 3

    var id: Int {
        rawValue
    }

    var title: String {
        switch self {
        case .again:
            return "Again"
        case .hard:
            return "Hard"
        case .good:
            return "Good"
        case .easy:
            return "Easy"
        }
    }

    var symbolName: String {
        switch self {
        case .again:
            return "arrow.uturn.backward.circle.fill"
        case .hard:
            return "tortoise.circle.fill"
        case .good:
            return "checkmark.circle.fill"
        case .easy:
            return "sparkles"
        }
    }
}

enum DeckCombineOperator: String, CaseIterable, Codable, Hashable, Identifiable {
    case and
    case or

    var id: String {
        rawValue
    }

    var title: String {
        rawValue.uppercased()
    }
}

enum DeckTagsOperator: String, CaseIterable, Codable, Hashable, Identifiable {
    case containsAny
    case containsAll

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .containsAny:
            return "Contains any"
        case .containsAll:
            return "Contains all"
        }
    }
}

enum CloudAccountState: String, CaseIterable, Codable, Hashable, Identifiable {
    case disconnected
    case linkingReady = "linking-ready"
    case linked

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .disconnected:
            return "Disconnected"
        case .linkingReady:
            return "Linking ready"
        case .linked:
            return "Linked"
        }
    }
}

enum DeckPredicate: Codable, Hashable {
    case effortLevel(values: [EffortLevel])
    case tags(operatorName: DeckTagsOperator, values: [String])

    private enum CodingKeys: String, CodingKey {
        case field
        case `operator`
        case values
    }

    private enum FieldValue: String, Codable {
        case effortLevel
        case tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let field = try container.decode(FieldValue.self, forKey: .field)

        switch field {
        case .effortLevel:
            let operatorValue = try container.decode(String.self, forKey: .operator)
            guard operatorValue == "in" else {
                throw DecodingError.dataCorruptedError(
                    forKey: .operator,
                    in: container,
                    debugDescription: "effortLevel predicate operator must be in"
                )
            }

            let values = try container.decode([EffortLevel].self, forKey: .values)
            self = .effortLevel(values: values)
        case .tags:
            let operatorName = try container.decode(DeckTagsOperator.self, forKey: .operator)
            let values = try container.decode([String].self, forKey: .values)
            self = .tags(operatorName: operatorName, values: values)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .effortLevel(let values):
            try container.encode(FieldValue.effortLevel, forKey: .field)
            try container.encode("in", forKey: .operator)
            try container.encode(values, forKey: .values)
        case .tags(let operatorName, let values):
            try container.encode(FieldValue.tags, forKey: .field)
            try container.encode(operatorName, forKey: .operator)
            try container.encode(values, forKey: .values)
        }
    }
}

struct DeckFilterDefinition: Codable, Hashable {
    let version: Int
    let combineWith: DeckCombineOperator
    let predicates: [DeckPredicate]
}

struct Workspace: Hashable {
    let workspaceId: String
    let name: String
    let createdAt: String
}

struct UserSettings: Hashable {
    let userId: String
    let workspaceId: String
    let email: String?
    let locale: String
    let createdAt: String
}

struct Card: Identifiable, Hashable {
    let cardId: String
    let workspaceId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
    let dueAt: String?
    let reps: Int
    let lapses: Int
    let serverVersion: Int64
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        cardId
    }
}

struct Deck: Identifiable, Hashable {
    let deckId: String
    let workspaceId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let updatedAt: String

    var id: String {
        deckId
    }
}

struct ReviewEvent: Identifiable, Hashable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String

    var id: String {
        reviewEventId
    }
}

struct CloudSettings: Hashable {
    let deviceId: String
    let cloudState: CloudAccountState
    let linkedUserId: String?
    let linkedWorkspaceId: String?
    let linkedEmail: String?
    let onboardingCompleted: Bool
    let updatedAt: String
}

struct HomeSnapshot: Hashable {
    let deckCount: Int
    let totalCards: Int
    let dueCount: Int
    let newCount: Int
    let reviewedCount: Int
}

struct DeckListItem: Identifiable, Hashable {
    let deck: Deck
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int

    var id: String {
        deck.deckId
    }
}

struct DeckCardStats: Hashable {
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int
}

struct AppStateSnapshot: Hashable {
    let workspace: Workspace
    let userSettings: UserSettings
    let cloudSettings: CloudSettings
    let cards: [Card]
    let decks: [Deck]
}

struct CardEditorInput: Hashable {
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
}

struct DeckEditorInput: Hashable {
    let name: String
    let filterDefinition: DeckFilterDefinition
}

struct ReviewSubmission: Hashable {
    let cardId: String
    let rating: ReviewRating
    let reviewedAtClient: String
}

struct ReviewSchedule: Hashable {
    let dueAt: Date
    let reps: Int
    let lapses: Int
}

enum LocalStoreError: LocalizedError {
    case database(String)
    case validation(String)
    case notFound(String)
    case uninitialized(String)

    var errorDescription: String? {
        switch self {
        case .database(let message):
            return message
        case .validation(let message):
            return message
        case .notFound(let message):
            return message
        case .uninitialized(let message):
            return message
        }
    }
}

private enum SQLiteValue {
    case integer(Int64)
    case text(String)
    case null
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
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

final class LocalDatabase {
    private let connection: OpaquePointer
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init() throws {
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.connection = try LocalDatabase.openConnection()
        sqlite3_busy_timeout(self.connection, 5_000)
        try self.enableForeignKeys()
        try self.migrate()
        try self.ensureDefaultState()
    }

    deinit {
        sqlite3_close(connection)
    }

    func loadStateSnapshot() throws -> AppStateSnapshot {
        let workspace = try self.loadWorkspace()
        let userSettings = try self.loadUserSettings(workspaceId: workspace.workspaceId)
        let cloudSettings = try self.loadCloudSettings()
        let cards = try self.loadCards(workspaceId: workspace.workspaceId)
        let decks = try self.loadDecks(workspaceId: workspace.workspaceId)

        return AppStateSnapshot(
            workspace: workspace,
            userSettings: userSettings,
            cloudSettings: cloudSettings,
            cards: cards,
            decks: decks
        )
    }

    func saveCard(workspaceId: String, input: CardEditorInput, cardId: String?) throws {
        try validateCardInput(input: input)

        let now = currentIsoTimestamp()
        let nextServerVersion = try self.nextServerVersion()
        let tagsData = try self.encoder.encode(input.tags)
        guard let tagsJson = String(data: tagsData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode card tags")
        }

        if let cardId {
            let updatedRows = try self.execute(
                sql: """
                UPDATE cards
                SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, updated_at = ?, server_version = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(input.frontText),
                    .text(input.backText),
                    .text(tagsJson),
                    .text(input.effortLevel.rawValue),
                    .text(now),
                    .integer(nextServerVersion),
                    .text(workspaceId),
                    .text(cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            return
        }

        let newCardId = UUID().uuidString.lowercased()
        try self.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                server_version,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)
            """,
            values: [
                .text(newCardId),
                .text(workspaceId),
                .text(input.frontText),
                .text(input.backText),
                .text(tagsJson),
                .text(input.effortLevel.rawValue),
                .text(now),
                .integer(nextServerVersion),
                .text(now)
            ]
        )
    }

    func deleteCard(workspaceId: String, cardId: String) throws {
        let now = currentIsoTimestamp()
        let nextServerVersion = try self.nextServerVersion()
        let updatedRows = try self.execute(
            sql: """
            UPDATE cards
            SET deleted_at = ?, updated_at = ?, server_version = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(now),
                .text(now),
                .integer(nextServerVersion),
                .text(workspaceId),
                .text(cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }
    }

    func createDeck(workspaceId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        let filterData = try self.encoder.encode(input.filterDefinition)
        guard let filterJson = String(data: filterData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode deck filter definition")
        }

        let deckId = UUID().uuidString.lowercased()
        let now = currentIsoTimestamp()
        try self.execute(
            sql: """
            INSERT INTO decks (
                deck_id,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(deckId),
                .text(workspaceId),
                .text(input.name),
                .text(filterJson),
                .text(now),
                .text(now)
            ]
        )
    }

    func updateDeck(workspaceId: String, deckId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        let filterData = try self.encoder.encode(input.filterDefinition)
        guard let filterJson = String(data: filterData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode deck filter definition")
        }

        let updatedRows = try self.execute(
            sql: """
            UPDATE decks
            SET name = ?, filter_definition_json = ?, updated_at = ?
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(input.name),
                .text(filterJson),
                .text(currentIsoTimestamp()),
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }
    }

    func deleteDeck(workspaceId: String, deckId: String) throws {
        let deletedRows = try self.execute(
            sql: "DELETE FROM decks WHERE workspace_id = ? AND deck_id = ?",
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if deletedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }
    }

    func submitReview(workspaceId: String, reviewSubmission: ReviewSubmission) throws {
        try self.inTransaction {
            let card = try self.loadCard(workspaceId: workspaceId, cardId: reviewSubmission.cardId)
            let now = Date()
            let schedule = computeReviewSchedule(
                currentReps: card.reps,
                currentLapses: card.lapses,
                rating: reviewSubmission.rating,
                now: now
            )
            let cloudSettings = try self.loadCloudSettings()
            let reviewEventId = UUID().uuidString.lowercased()
            let clientEventId = UUID().uuidString.lowercased()
            let reviewedAtServer = currentIsoTimestamp()

            try self.execute(
                sql: """
                INSERT INTO review_events (
                    review_event_id,
                    workspace_id,
                    card_id,
                    device_id,
                    client_event_id,
                    rating,
                    reviewed_at_client,
                    reviewed_at_server
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(reviewEventId),
                    .text(workspaceId),
                    .text(reviewSubmission.cardId),
                    .text(cloudSettings.deviceId),
                    .text(clientEventId),
                    .integer(Int64(reviewSubmission.rating.rawValue)),
                    .text(reviewSubmission.reviewedAtClient),
                    .text(reviewedAtServer)
                ]
            )

            let updatedRows = try self.execute(
                sql: """
                UPDATE cards
                SET due_at = ?, reps = ?, lapses = ?, updated_at = ?, server_version = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(isoTimestamp(date: schedule.dueAt)),
                    .integer(Int64(schedule.reps)),
                    .integer(Int64(schedule.lapses)),
                    .text(reviewedAtServer),
                    .integer(try self.nextServerVersion()),
                    .text(workspaceId),
                    .text(reviewSubmission.cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }
        }
    }

    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        let updatedRows = try self.execute(
            sql: """
            UPDATE app_local_settings
            SET cloud_state = ?, linked_user_id = ?, linked_workspace_id = ?, linked_email = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(cloudState.rawValue),
                linkedUserId.map(SQLiteValue.text) ?? .null,
                linkedWorkspaceId.map(SQLiteValue.text) ?? .null,
                linkedEmail.map(SQLiteValue.text) ?? .null,
                .text(currentIsoTimestamp())
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("App local settings row is missing")
        }
    }

    private static func openConnection() throws -> OpaquePointer {
        let databasePath = try self.databasePath()
        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let resultCode = sqlite3_open_v2(databasePath, &connection, flags, nil)

        guard resultCode == SQLITE_OK, let connection else {
            let message = connection.map { connection in
                String(cString: sqlite3_errmsg(connection))
            } ?? "Unknown SQLite open error"
            if let connection {
                sqlite3_close(connection)
            }
            throw LocalStoreError.database("Failed to open local database: \(message)")
        }

        return connection
    }

    private static func databasePath() throws -> String {
        guard let applicationSupportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw LocalStoreError.database("Application Support directory is unavailable")
        }

        let databaseDirectory = applicationSupportDirectory.appendingPathComponent("Flashcards", isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )

        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false).path
    }

    private func enableForeignKeys() throws {
        let resultCode = sqlite3_exec(connection, "PRAGMA foreign_keys = ON;", nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to enable SQLite foreign keys: \(self.lastErrorMessage())")
        }
    }

    private func migrate() throws {
        let migrationSQL = """
        CREATE TABLE IF NOT EXISTS workspaces (
            workspace_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            workspace_id TEXT REFERENCES workspaces(workspace_id) ON DELETE SET NULL,
            email TEXT,
            locale TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cards (
            card_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            front_text TEXT NOT NULL,
            back_text TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            effort_level TEXT NOT NULL CHECK (effort_level IN ('fast', 'medium', 'long')),
            due_at TEXT,
            reps INTEGER NOT NULL CHECK (reps >= 0),
            lapses INTEGER NOT NULL CHECK (lapses >= 0),
            server_version INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS decks (
            deck_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            filter_definition_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS review_events (
            review_event_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            client_event_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
            reviewed_at_client TEXT NOT NULL,
            reviewed_at_server TEXT NOT NULL,
            UNIQUE (workspace_id, device_id, client_event_id)
        );

        CREATE TABLE IF NOT EXISTS app_local_settings (
            settings_id INTEGER PRIMARY KEY CHECK (settings_id = 1),
            device_id TEXT NOT NULL,
            cloud_state TEXT NOT NULL CHECK (cloud_state IN ('disconnected', 'linking-ready', 'linked')),
            linked_user_id TEXT,
            linked_workspace_id TEXT,
            linked_email TEXT,
            onboarding_completed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_server_version
            ON cards(workspace_id, server_version);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at
            ON cards(workspace_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active
            ON cards(workspace_id, due_at)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_decks_workspace_updated_at
            ON decks(workspace_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
            ON review_events(workspace_id, card_id, reviewed_at_server DESC);
        """

        let resultCode = sqlite3_exec(connection, migrationSQL, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to run local migrations: \(self.lastErrorMessage())")
        }
    }

    private func ensureDefaultState() throws {
        let workspaceCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces",
            values: []
        )
        let workspaceId: String

        if workspaceCount == 0 {
            workspaceId = UUID().uuidString.lowercased()
            try self.execute(
                sql: "INSERT INTO workspaces (workspace_id, name, created_at) VALUES (?, ?, ?)",
                values: [
                    .text(workspaceId),
                    .text("Local Workspace"),
                    .text(currentIsoTimestamp())
                ]
            )
        } else {
            workspaceId = try self.scalarText(
                sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC LIMIT 1",
                values: []
            )
        }

        let userSettingsCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM user_settings",
            values: []
        )
        if userSettingsCount == 0 {
            let locale = Locale.current.language.languageCode?.identifier ?? "en"
            try self.execute(
                sql: """
                INSERT INTO user_settings (user_id, workspace_id, email, locale, created_at)
                VALUES (?, ?, NULL, ?, ?)
                """,
                values: [
                    .text("local-user"),
                    .text(workspaceId),
                    .text(locale),
                    .text(currentIsoTimestamp())
                ]
            )
        }

        let appSettingsCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM app_local_settings",
            values: []
        )
        if appSettingsCount == 0 {
            try self.execute(
                sql: """
                INSERT INTO app_local_settings (
                    settings_id,
                    device_id,
                    cloud_state,
                    linked_user_id,
                    linked_workspace_id,
                    linked_email,
                    onboarding_completed,
                    updated_at
                )
                VALUES (1, ?, 'disconnected', NULL, NULL, NULL, 0, ?)
                """,
                values: [
                    .text(UUID().uuidString.lowercased()),
                    .text(currentIsoTimestamp())
                ]
            )
        }
    }

    private func loadWorkspace() throws -> Workspace {
        let workspaces = try self.query(
            sql: """
            SELECT workspace_id, name, created_at
            FROM workspaces
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: []
        ) { statement in
            Workspace(
                workspaceId: Self.columnText(statement: statement, index: 0),
                name: Self.columnText(statement: statement, index: 1),
                createdAt: Self.columnText(statement: statement, index: 2)
            )
        }

        guard let workspace = workspaces.first else {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return workspace
    }

    private func loadUserSettings(workspaceId: String) throws -> UserSettings {
        let rows = try self.query(
            sql: """
            SELECT user_id, workspace_id, email, locale, created_at
            FROM user_settings
            WHERE workspace_id = ?
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            UserSettings(
                userId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                email: Self.columnOptionalText(statement: statement, index: 2),
                locale: Self.columnText(statement: statement, index: 3),
                createdAt: Self.columnText(statement: statement, index: 4)
            )
        }

        guard let userSettings = rows.first else {
            throw LocalStoreError.database("User settings row is missing")
        }

        return userSettings
    }

    private func loadCards(workspaceId: String) throws -> [Card] {
        try self.query(
            sql: """
            SELECT
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                server_version,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let tagsJson = Self.columnText(statement: statement, index: 4)
            let tagsData = Data(tagsJson.utf8)
            let tags = try self.decoder.decode([String].self, from: tagsData)
            let rawEffortLevel = Self.columnText(statement: statement, index: 5)
            guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
                throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
            }

            return Card(
                cardId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                frontText: Self.columnText(statement: statement, index: 2),
                backText: Self.columnText(statement: statement, index: 3),
                tags: tags,
                effortLevel: effortLevel,
                dueAt: Self.columnOptionalText(statement: statement, index: 6),
                reps: Int(Self.columnInt64(statement: statement, index: 7)),
                lapses: Int(Self.columnInt64(statement: statement, index: 8)),
                serverVersion: Self.columnInt64(statement: statement, index: 9),
                updatedAt: Self.columnText(statement: statement, index: 10),
                deletedAt: Self.columnOptionalText(statement: statement, index: 11)
            )
        }
    }

    private func loadDecks(workspaceId: String) throws -> [Deck] {
        try self.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, updated_at
            FROM decks
            WHERE workspace_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let filterJson = Self.columnText(statement: statement, index: 3)
            let filterData = Data(filterJson.utf8)
            let filterDefinition = try self.decoder.decode(DeckFilterDefinition.self, from: filterData)

            return Deck(
                deckId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                name: Self.columnText(statement: statement, index: 2),
                filterDefinition: filterDefinition,
                createdAt: Self.columnText(statement: statement, index: 4),
                updatedAt: Self.columnText(statement: statement, index: 5)
            )
        }
    }

    private func loadCloudSettings() throws -> CloudSettings {
        let settings = try self.query(
            sql: """
            SELECT device_id, cloud_state, linked_user_id, linked_workspace_id, linked_email, onboarding_completed, updated_at
            FROM app_local_settings
            WHERE settings_id = 1
            LIMIT 1
            """,
            values: []
        ) { statement in
            let rawCloudState = Self.columnText(statement: statement, index: 1)
            guard let cloudState = CloudAccountState(rawValue: rawCloudState) else {
                throw LocalStoreError.database("Stored cloud state is invalid: \(rawCloudState)")
            }

            return CloudSettings(
                deviceId: Self.columnText(statement: statement, index: 0),
                cloudState: cloudState,
                linkedUserId: Self.columnOptionalText(statement: statement, index: 2),
                linkedWorkspaceId: Self.columnOptionalText(statement: statement, index: 3),
                linkedEmail: Self.columnOptionalText(statement: statement, index: 4),
                onboardingCompleted: Self.columnInt64(statement: statement, index: 5) == 1,
                updatedAt: Self.columnText(statement: statement, index: 6)
            )
        }

        guard let cloudSettings = settings.first else {
            throw LocalStoreError.database("App local settings row is missing")
        }

        return cloudSettings
    }

    private func loadCard(workspaceId: String, cardId: String) throws -> Card {
        let cards = try self.query(
            sql: """
            SELECT
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                server_version,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(cardId)
            ]
        ) { statement in
            let tagsJson = Self.columnText(statement: statement, index: 4)
            let tagsData = Data(tagsJson.utf8)
            let tags = try self.decoder.decode([String].self, from: tagsData)
            let rawEffortLevel = Self.columnText(statement: statement, index: 5)
            guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
                throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
            }

            return Card(
                cardId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                frontText: Self.columnText(statement: statement, index: 2),
                backText: Self.columnText(statement: statement, index: 3),
                tags: tags,
                effortLevel: effortLevel,
                dueAt: Self.columnOptionalText(statement: statement, index: 6),
                reps: Int(Self.columnInt64(statement: statement, index: 7)),
                lapses: Int(Self.columnInt64(statement: statement, index: 8)),
                serverVersion: Self.columnInt64(statement: statement, index: 9),
                updatedAt: Self.columnText(statement: statement, index: 10),
                deletedAt: Self.columnOptionalText(statement: statement, index: 11)
            )
        }

        guard let card = cards.first else {
            throw LocalStoreError.notFound("Card not found")
        }

        return card
    }

    private func nextServerVersion() throws -> Int64 {
        let maxServerVersion = try self.scalarInt(
            sql: "SELECT COALESCE(MAX(server_version), 0) FROM cards",
            values: []
        )

        return Int64(maxServerVersion + 1)
    }

    private func scalarInt(sql: String, values: [SQLiteValue]) throws -> Int {
        let results = try self.query(
            sql: sql,
            values: values
        ) { statement in
            Int(Self.columnInt64(statement: statement, index: 0))
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected an integer result for SQL query")
        }

        return value
    }

    private func scalarText(sql: String, values: [SQLiteValue]) throws -> String {
        let results = try self.query(
            sql: sql,
            values: values
        ) { statement in
            Self.columnText(statement: statement, index: 0)
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected a text result for SQL query")
        }

        return value
    }

    @discardableResult
    private func execute(sql: String, values: [SQLiteValue]) throws -> Int {
        var statement: OpaquePointer?
        let prepareResult = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
        guard prepareResult == SQLITE_OK, let statement else {
            throw LocalStoreError.database("Failed to prepare statement: \(self.lastErrorMessage())")
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(values: values, to: statement)
        let stepResult = sqlite3_step(statement)
        guard stepResult == SQLITE_DONE else {
            throw LocalStoreError.database("Failed to execute statement: \(self.lastErrorMessage())")
        }

        return Int(sqlite3_changes(connection))
    }

    private func query<T>(
        sql: String,
        values: [SQLiteValue],
        map: (OpaquePointer) throws -> T
    ) throws -> [T] {
        var statement: OpaquePointer?
        let prepareResult = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
        guard prepareResult == SQLITE_OK, let statement else {
            throw LocalStoreError.database("Failed to prepare query: \(self.lastErrorMessage())")
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(values: values, to: statement)

        var rows: [T] = []
        while true {
            let stepResult = sqlite3_step(statement)
            if stepResult == SQLITE_ROW {
                rows.append(try map(statement))
                continue
            }

            if stepResult == SQLITE_DONE {
                break
            }

            throw LocalStoreError.database("Failed to execute query: \(self.lastErrorMessage())")
        }

        return rows
    }

    private func inTransaction<T>(_ body: () throws -> T) throws -> T {
        let beginResult = sqlite3_exec(connection, "BEGIN IMMEDIATE TRANSACTION", nil, nil, nil)
        guard beginResult == SQLITE_OK else {
            throw LocalStoreError.database("Failed to begin transaction: \(self.lastErrorMessage())")
        }

        do {
            let result = try body()
            let commitResult = sqlite3_exec(connection, "COMMIT TRANSACTION", nil, nil, nil)
            guard commitResult == SQLITE_OK else {
                throw LocalStoreError.database("Failed to commit transaction: \(self.lastErrorMessage())")
            }
            return result
        } catch {
            sqlite3_exec(connection, "ROLLBACK TRANSACTION", nil, nil, nil)
            throw error
        }
    }

    private func bind(values: [SQLiteValue], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)

            switch value {
            case .integer(let integer):
                guard sqlite3_bind_int64(statement, index, integer) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind integer parameter at index \(offset)")
                }
            case .text(let text):
                guard sqlite3_bind_text(statement, index, text, -1, sqliteTransient) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind text parameter at index \(offset)")
                }
            case .null:
                guard sqlite3_bind_null(statement, index) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind null parameter at index \(offset)")
                }
            }
        }
    }

    private func lastErrorMessage() -> String {
        String(cString: sqlite3_errmsg(connection))
    }

    private static func columnText(statement: OpaquePointer, index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else {
            return ""
        }

        return String(cString: value)
    }

    private static func columnOptionalText(statement: OpaquePointer, index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return self.columnText(statement: statement, index: index)
    }

    private static func columnInt64(statement: OpaquePointer, index: Int32) -> Int64 {
        sqlite3_column_int64(statement, index)
    }
}

@MainActor
final class FlashcardsStore: ObservableObject {
    @Published private(set) var workspace: Workspace?
    @Published private(set) var userSettings: UserSettings?
    @Published private(set) var cloudSettings: CloudSettings?
    @Published private(set) var cards: [Card]
    @Published private(set) var decks: [Deck]
    @Published private(set) var deckItems: [DeckListItem]
    @Published private(set) var reviewQueue: [Card]
    @Published private(set) var homeSnapshot: HomeSnapshot
    @Published private(set) var globalErrorMessage: String

    private let database: LocalDatabase?

    init() {
        self.workspace = nil
        self.userSettings = nil
        self.cloudSettings = nil
        self.cards = []
        self.decks = []
        self.deckItems = []
        self.reviewQueue = []
        self.homeSnapshot = HomeSnapshot(
            deckCount: 0,
            totalCards: 0,
            dueCount: 0,
            newCount: 0,
            reviewedCount: 0
        )
        self.globalErrorMessage = ""

        let database: LocalDatabase?
        do {
            database = try LocalDatabase()
        } catch {
            database = nil
            self.globalErrorMessage = localizedMessage(error: error)
        }

        self.database = database

        if database != nil {
            do {
                try self.reload()
            } catch {
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
    }

    func reload() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let snapshot = try database.loadStateSnapshot()
        let now = Date()
        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.cloudSettings = snapshot.cloudSettings
        self.cards = snapshot.cards
        self.decks = snapshot.decks
        self.deckItems = makeDeckListItems(decks: snapshot.decks, cards: snapshot.cards, now: now)
        self.reviewQueue = sortCardsForReviewQueue(cards: snapshot.cards, now: now)
        self.homeSnapshot = makeHomeSnapshot(cards: snapshot.cards, deckCount: snapshot.decks.count, now: now)
        self.globalErrorMessage = ""
    }

    func saveCard(input: CardEditorInput, editingCardId: String?) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.saveCard(workspaceId: workspaceId, input: input, cardId: editingCardId)
        try self.reload()
    }

    func deleteCard(cardId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.deleteCard(workspaceId: workspaceId, cardId: cardId)
        try self.reload()
    }

    func createDeck(input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.createDeck(workspaceId: workspaceId, input: input)
        try self.reload()
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.updateDeck(workspaceId: workspaceId, deckId: deckId, input: input)
        try self.reload()
    }

    func deleteDeck(deckId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.deleteDeck(workspaceId: workspaceId, deckId: deckId)
        try self.reload()
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: rating,
                reviewedAtClient: currentIsoTimestamp()
            )
        )
        try self.reload()
    }

    func prepareCloudLink() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .linkingReady,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        try self.reload()
    }

    func previewLinkedCloudAccount() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspace = self.workspace else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "preview-user",
            linkedWorkspaceId: workspace.workspaceId,
            linkedEmail: "preview@flashcards-open-source-app.com"
        )
        try self.reload()
    }

    func disconnectCloudAccount() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        try self.reload()
    }

    func cardsMatchingDeck(deck: Deck) -> [Card] {
        matchingCardsForDeck(deck: deck, cards: self.cards)
    }
}

private func validateCardInput(input: CardEditorInput) throws {
    let frontText = input.frontText.trimmingCharacters(in: .whitespacesAndNewlines)
    let backText = input.backText.trimmingCharacters(in: .whitespacesAndNewlines)

    if frontText.isEmpty {
        throw LocalStoreError.validation("Card front text must not be empty")
    }

    if backText.isEmpty {
        throw LocalStoreError.validation("Card back text must not be empty")
    }
}

private func validateDeckInput(input: DeckEditorInput) throws {
    if input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw LocalStoreError.validation("Deck name must not be empty")
    }

    if input.filterDefinition.version != 1 {
        throw LocalStoreError.validation("Deck filter version must be 1")
    }
}
