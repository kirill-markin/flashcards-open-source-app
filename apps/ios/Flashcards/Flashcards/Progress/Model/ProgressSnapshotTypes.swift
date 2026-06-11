import Foundation

struct ProgressCalendarDay: Hashable, Identifiable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let isToday: Bool
    let isFuturePlaceholder: Bool
    let dayNumber: Int

    var id: String {
        self.localDate
    }
}

struct ProgressCalendarWeek: Hashable, Identifiable, Sendable {
    let days: [ProgressCalendarDay]

    var id: String {
        guard let firstDay = self.days.first else {
            preconditionFailure("Progress calendar week must contain at least one day")
        }

        return firstDay.localDate
    }
}

struct ProgressChartDay: Hashable, Identifiable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let isToday: Bool

    var id: String {
        self.localDate
    }
}

struct ProgressChartData: Hashable, Sendable {
    let chartDays: [ProgressChartDay]
}

struct ProgressSnapshot: Hashable, Sendable {
    let scopeKey: ProgressScopeKey
    let summary: ProgressSummary
    let chartData: ProgressChartData
    let summarySourceState: ProgressSourceState
    let seriesSourceState: ProgressSourceState
    let isApproximate: Bool
    let generatedAt: String?
}

struct ReviewScheduleSnapshot: Hashable, Sendable {
    let scopeKey: ReviewScheduleScopeKey
    let schedule: UserReviewSchedule
    let sourceState: ProgressSourceState
    let isApproximate: Bool
    let generatedAt: String?
}

struct ProgressLeaderboardSnapshot: Hashable, Sendable {
    let scopeKey: ProgressLeaderboardScopeKey
    let state: ProgressLeaderboardSnapshotState
}

enum ProgressLeaderboardSnapshotState: Hashable, Sendable {
    /// Guest or disconnected accounts, or a server payload requiring a linked account.
    case signInRequired
    /// The user opted out of leaderboard participation.
    case participationDisabled
    /// The server is reachable but has not generated leaderboard snapshots yet.
    case snapshotUnavailable
    /// Linked account without a cached server payload (first load or offline).
    case awaitingServerData
    case ready(ProgressLeaderboardReadyState)
}

struct ProgressLeaderboardReadyState: Hashable, Sendable {
    let defaultWindowKey: LeaderboardWindowKey
    let windows: [ProgressLeaderboardWindowState]
}

struct ProgressLeaderboardWindowState: Hashable, Identifiable, Sendable {
    let windowKey: LeaderboardWindowKey
    let snapshotGeneratedAt: String
    let participantCount: Int
    let viewerRank: Int
    /// Server snapshot count overlaid with the local live qualified count for the viewer.
    let viewerQualifiedReviewCount: Int
    let rows: [ProgressLeaderboardRowState]

    var id: LeaderboardWindowKey {
        self.windowKey
    }
}

enum ProgressLeaderboardRowState: Hashable, Identifiable, Sendable {
    case participant(ProgressLeaderboardParticipantRowState)
    case gap

    var id: String {
        switch self {
        case .participant(let row):
            return "participant-\(row.rank)-\(row.publicProfileId)"
        case .gap:
            return "gap"
        }
    }
}

struct ProgressLeaderboardParticipantRowState: Hashable, Sendable {
    let kind: ProgressLeaderboardParticipantKind
    let publicProfileId: String
    let anonymousDisplayName: String
    let qualifiedReviewCount: Int
    let rank: Int
}
