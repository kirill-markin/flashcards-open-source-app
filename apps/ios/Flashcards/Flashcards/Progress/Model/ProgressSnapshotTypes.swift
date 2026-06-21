import Foundation

struct ProgressCalendarDay: Hashable, Identifiable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let streakState: ProgressStreakDayState
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
    let streakState: ProgressStreakDayState
    let againCount: Int
    let hardCount: Int
    let goodCount: Int
    let easyCount: Int
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

struct ProgressLeaderboardBestPlacement: Hashable, Sendable {
    let windowKey: LeaderboardWindowKey
    let rank: Int
}

func resolveBestLeaderboardPlacement(readyState: ProgressLeaderboardReadyState) -> ProgressLeaderboardBestPlacement? {
    var bestPlacement: ProgressLeaderboardBestPlacement?

    for windowKey in LeaderboardWindowKey.stableOrder {
        guard let window = readyState.windows.first(where: { candidate in
            candidate.windowKey == windowKey
        }) else {
            continue
        }

        if let currentBestPlacement = bestPlacement,
           window.viewerRank >= currentBestPlacement.rank {
            continue
        }

        bestPlacement = ProgressLeaderboardBestPlacement(
            windowKey: window.windowKey,
            rank: window.viewerRank
        )
    }

    return bestPlacement
}

func resolveBestLeaderboardPlacement(snapshot: ProgressLeaderboardSnapshot?) -> ProgressLeaderboardBestPlacement? {
    guard let snapshot,
          case .ready(let readyState) = snapshot.state else {
        return nil
    }

    return resolveBestLeaderboardPlacement(readyState: readyState)
}

struct ProgressLeaderboardWindowState: Hashable, Identifiable, Sendable {
    let windowKey: LeaderboardWindowKey
    let snapshotGeneratedAt: String
    let participantCount: Int
    /// Viewer rank after applying the local live qualified count to the frozen ranking.
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
    case gap(ProgressLeaderboardGapRowState)

    var id: String {
        switch self {
        case .participant(let row):
            return "participant-\(row.rank)-\(row.publicProfileId)"
        case .gap(let row):
            return row.id
        }
    }
}

struct ProgressLeaderboardGapRowState: Hashable, Sendable {
    let id: String
}

struct ProgressLeaderboardParticipantRowState: Hashable, Sendable {
    let kind: ProgressLeaderboardParticipantKind
    let publicProfileId: String
    let anonymousDisplayName: String
    let friendDisplayName: String?
    let qualifiedReviewCount: Int
    let rank: Int
}

struct ProgressLeaderboardSelectedProfile: Hashable, Identifiable, Sendable {
    let publicProfileId: String
    let anonymousDisplayName: String
    let friendDisplayName: String?
    let isViewer: Bool

    var id: String {
        self.publicProfileId
    }
}

struct ProgressStreakLeaderboardSnapshot: Hashable, Sendable {
    let scopeKey: ProgressLeaderboardScopeKey
    let state: ProgressStreakLeaderboardSnapshotState
}

enum ProgressStreakLeaderboardSnapshotState: Hashable, Sendable {
    /// Linked account without a cached server payload and no personal Progress snapshot yet.
    case awaitingServerData
    case ready(ProgressStreakLeaderboardReadyState)
}

struct ProgressStreakLeaderboardReadyState: Hashable, Sendable {
    let snapshotGeneratedAt: String?
    let asOfUtcDate: String?
    let participantCount: Int
    /// Viewer rank after applying the live personal streak to the frozen daily ranking.
    let viewerRank: Int
    /// Server snapshot streak overlaid with the current personal Progress streak.
    let viewerStreakDays: Int
    let rows: [ProgressStreakLeaderboardRowState]
}

enum ProgressStreakLeaderboardRowState: Hashable, Identifiable, Sendable {
    case participant(ProgressStreakLeaderboardParticipantRowState)
    case gap(ProgressLeaderboardGapRowState)

    var id: String {
        switch self {
        case .participant(let row):
            return "participant-\(row.rank)-\(row.publicProfileId ?? "local-viewer")"
        case .gap(let row):
            return row.id
        }
    }
}

struct ProgressStreakLeaderboardParticipantRowState: Hashable, Sendable {
    let kind: ProgressLeaderboardParticipantKind
    let publicProfileId: String?
    let anonymousDisplayName: String
    let friendDisplayName: String?
    let streakDays: Int
    let rank: Int
}
