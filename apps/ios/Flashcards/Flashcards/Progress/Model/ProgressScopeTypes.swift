import Foundation

struct ProgressScopeKey: Codable, Hashable, Sendable {
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    /// Tracks the canonical cached workspace membership that contributes to aggregated progress.
    /// Switching the active workspace keeps this stable, but create/delete/merge membership changes rotate the scope.
    let workspaceMembershipKey: String
    let timeZone: String
    let from: String
    let to: String

    var storageKey: String {
        let cloudStateKey = self.cloudState?.rawValue ?? "none"
        let linkedUserIdKey = self.linkedUserId ?? "none"
        return [
            cloudStateKey,
            linkedUserIdKey,
            self.workspaceMembershipKey,
            self.timeZone,
            self.from,
            self.to,
        ].joined(separator: "|")
    }
}

struct ProgressSummaryScopeKey: Codable, Hashable, Sendable {
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let workspaceMembershipKey: String
    let timeZone: String
    /// Summary fields such as hasReviewedToday and currentStreakDays are relative to a local "today".
    /// Keep the cache keyed by that local date so yesterday's summary is never reused after midnight.
    let referenceLocalDate: String

    var storageKey: String {
        let cloudStateKey = self.cloudState?.rawValue ?? "none"
        let linkedUserIdKey = self.linkedUserId ?? "none"
        return [
            cloudStateKey,
            linkedUserIdKey,
            self.workspaceMembershipKey,
            self.timeZone,
            self.referenceLocalDate,
        ].joined(separator: "|")
    }
}

struct ReviewScheduleScopeKey: Codable, Hashable, Sendable {
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let workspaceMembershipKey: String
    let timeZone: String
    /// Schedule buckets are relative to the user's local "today".
    /// Keep the cache keyed by that local date so "Today" rotates cleanly after midnight.
    let referenceLocalDate: String

    var storageKey: String {
        let cloudStateKey = self.cloudState?.rawValue ?? "none"
        let linkedUserIdKey = self.linkedUserId ?? "none"
        return [
            cloudStateKey,
            linkedUserIdKey,
            self.workspaceMembershipKey,
            self.timeZone,
            self.referenceLocalDate,
        ].joined(separator: "|")
    }
}
