import Foundation

/// The iPhone's saved Review filter for the workspace, kept under the iPhone's own per-workspace key
/// so offline launches show the same cards.
func saveWatchReviewFilter(
    persistedReviewFilter: PersistedReviewFilter,
    workspaceId: String,
    userDefaults: UserDefaults
) throws {
    let data = try JSONEncoder().encode(persistedReviewFilter)
    userDefaults.set(data, forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
}

func loadWatchReviewFilter(workspaceId: String, userDefaults: UserDefaults) throws -> ReviewFilter {
    guard let data = userDefaults.data(forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId)) else {
        return .allCards
    }

    let persistedReviewFilter = try JSONDecoder().decode(PersistedReviewFilter.self, from: data)
    return try makeReviewFilter(persistedReviewFilter: persistedReviewFilter)
}
