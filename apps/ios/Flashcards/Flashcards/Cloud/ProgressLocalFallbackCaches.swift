import Foundation

struct ProgressReviewedAtClientCacheKey: Hashable, Sendable {
    let workspaceMembershipKey: String
    let installationId: String?
    let revision: Int
}

struct ProgressReviewedAtClientCacheEntry: Sendable {
    let key: ProgressReviewedAtClientCacheKey
    let sources: ProgressReviewedAtClientSources
}

struct ProgressReviewScheduleLocalCacheKey: Hashable, Sendable {
    let workspaceMembershipKey: String
    let timeZone: String
    let referenceLocalDate: String
    let installationId: String?
    let revision: Int
}

struct ProgressReviewScheduleLocalCacheEntry: Sendable {
    let key: ProgressReviewScheduleLocalCacheKey
    let reviewSchedule: UserReviewSchedule
    let pendingOverlayState: ProgressPendingLocalOverlayState
    let pendingCardTotalDelta: Int
    let localCoverage: ReviewScheduleLocalCoverage
}
