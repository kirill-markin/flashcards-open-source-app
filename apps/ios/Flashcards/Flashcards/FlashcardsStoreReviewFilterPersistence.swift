import Foundation

enum PersistedReviewFilterKind: String, Codable {
    case allCards
    case deck
    case tag
}

struct PersistedReviewFilter: Codable, Hashable {
    let kind: PersistedReviewFilterKind
    let deckId: String?
    let tag: String?
}

let selectedReviewFilterUserDefaultsKey: String = "selected-review-filter"
let selectedReviewFilterUserDefaultsKeyPrefix: String = "selected-review-filter::"

func makeSelectedReviewFilterUserDefaultsKey(workspaceId: String) -> String {
    "\(selectedReviewFilterUserDefaultsKeyPrefix)\(workspaceId)"
}

func clearStoredReviewFilters(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)

    for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(selectedReviewFilterUserDefaultsKeyPrefix) {
        userDefaults.removeObject(forKey: key)
    }
}

func makePersistedReviewFilter(reviewFilter: ReviewFilter) -> PersistedReviewFilter {
    switch reviewFilter {
    case .allCards:
        return PersistedReviewFilter(kind: .allCards, deckId: nil, tag: nil)
    case .deck(let deckId):
        return PersistedReviewFilter(kind: .deck, deckId: deckId, tag: nil)
    case .tag(let tag):
        return PersistedReviewFilter(kind: .tag, deckId: nil, tag: tag)
    }
}

func makeReviewFilter(persistedReviewFilter: PersistedReviewFilter) throws -> ReviewFilter {
    switch persistedReviewFilter.kind {
    case .allCards:
        return .allCards
    case .deck:
        guard let deckId = persistedReviewFilter.deckId, deckId.isEmpty == false else {
            throw LocalStoreError.validation("Persisted review filter is missing deckId")
        }

        return .deck(deckId: deckId)
    case .tag:
        guard let tag = persistedReviewFilter.tag, tag.isEmpty == false else {
            throw LocalStoreError.validation("Persisted review filter is missing tag")
        }

        return .tag(tag: tag)
    }
}

extension FlashcardsStore {
    static func loadSelectedReviewFilter(
        userDefaults: UserDefaults,
        decoder: JSONDecoder,
        workspaceId: String?
    ) -> ReviewFilter {
        guard
            let workspaceId,
            let data = userDefaults.data(forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
        else {
            return .allCards
        }

        do {
            let persistedReviewFilter = try decoder.decode(PersistedReviewFilter.self, from: data)
            return try makeReviewFilter(persistedReviewFilter: persistedReviewFilter)
        } catch {
            userDefaults.removeObject(forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
            return .allCards
        }
    }
}
