import Foundation

private let progressLeaderboardMaximumGapRowCount: Int = 2

// Wire contract for GET /me/progress/leaderboard.
// Keep aligned with api/src/openapi.yaml and
// apps/backend/src/community/leaderboard/progressLeaderboard.ts.
enum LeaderboardWindowKey: String, Codable, CaseIterable, Identifiable, Sendable {
    case last24Hours = "last_24_hours"
    case last3Days = "last_3_days"
    case last7Days = "last_7_days"
    case last30Days = "last_30_days"
    case allTime = "all_time"

    static let stableOrder: [LeaderboardWindowKey] = [
        .last24Hours,
        .last3Days,
        .last7Days,
        .last30Days,
        .allTime,
    ]

    var id: String {
        self.rawValue
    }

    /// Rolling window length in hours anchored at the current device time; nil for all time.
    var rollingWindowHours: Int? {
        switch self {
        case .last24Hours:
            return 24
        case .last3Days:
            return 72
        case .last7Days:
            return 168
        case .last30Days:
            return 720
        case .allTime:
            return nil
        }
    }
}

enum ProgressLeaderboardStatus: String, Codable, Hashable, Sendable {
    case ready
    case linkedAccountRequired = "linked_account_required"
    case participationDisabled = "participation_disabled"
    case snapshotUnavailable = "snapshot_unavailable"
}

struct ProgressLeaderboardMetric: Codable, Hashable, Sendable {
    let metricVersion: String
    let title: String
    let description: String
}

struct ProgressLeaderboardViewer: Codable, Hashable, Sendable {
    let publicProfileId: String
    let displayName: String
    let rank: Int
    let qualifiedReviewCount: Int
}

enum ProgressLeaderboardParticipantKind: String, Codable, Hashable, Sendable {
    case top
    case neighbor
    case viewer
}

struct ProgressLeaderboardParticipantRow: Codable, Hashable, Sendable {
    let kind: ProgressLeaderboardParticipantKind
    let publicProfileId: String
    /// Server-generated from the public profile id and the request locale.
    /// Clients must never generate or persist their own anonymous names.
    let anonymousDisplayName: String
    /// Viewer-private friend label shown only for current opted-in friends.
    let friendDisplayName: String?
    let qualifiedReviewCount: Int
    let rank: Int
}

enum ProgressLeaderboardRankingRowKind: String, Codable, Hashable, Sendable {
    case participant
    case viewer
}

struct ProgressLeaderboardRankingRow: Codable, Hashable, Sendable {
    let kind: ProgressLeaderboardRankingRowKind
    let publicProfileId: String
    /// Server-generated from the public profile id and the request locale.
    /// Clients must never generate or persist their own anonymous names.
    let anonymousDisplayName: String
    /// Viewer-private friend label shown only for current opted-in friends.
    let friendDisplayName: String?
    let qualifiedReviewCount: Int
    let rank: Int
}

enum ProgressLeaderboardRow: Codable, Hashable, Sendable {
    case participant(ProgressLeaderboardParticipantRow)
    case gap

    private enum CodingKeys: String, CodingKey {
        case kind
    }

    private static let gapKindRawValue: String = "gap"

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        if kind == Self.gapKindRawValue {
            self = .gap
            return
        }

        self = .participant(try ProgressLeaderboardParticipantRow(from: decoder))
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .gap:
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(Self.gapKindRawValue, forKey: .kind)
        case .participant(let participantRow):
            try participantRow.encode(to: encoder)
        }
    }
}

struct ProgressLeaderboardWindow: Codable, Hashable, Sendable {
    let windowKey: LeaderboardWindowKey
    let snapshotId: String
    let snapshotGeneratedAt: String
    let asOfServerHour: String
    let nextRefreshAfter: String
    let participantCount: Int
    let viewer: ProgressLeaderboardViewer
    let rows: [ProgressLeaderboardRow]
    let rankingRows: [ProgressLeaderboardRankingRow]
}

struct UserProgressLeaderboard: Codable, Hashable, Sendable {
    let status: ProgressLeaderboardStatus
    let metric: ProgressLeaderboardMetric
    let defaultWindowKey: LeaderboardWindowKey
    /// Empty unless status is ready; otherwise one window per leaderboard window key.
    let windows: [ProgressLeaderboardWindow]
}

enum ProgressLeaderboardValidationError: LocalizedError {
    case unexpectedWindows(status: String, windowCount: Int)
    case invalidWindowKeys([String])
    case invalidTimestamp(windowKey: String, field: String, value: String)
    case negativeParticipantCount(windowKey: String, participantCount: Int)
    case invalidViewerRank(windowKey: String, rank: Int, participantCount: Int)
    case negativeReviewCount(windowKey: String, reviewCount: Int)
    case invalidRowRank(windowKey: String, rank: Int)
    case rankingRowCountMismatch(windowKey: String, participantCount: Int, rankingRowCount: Int)
    case invalidRankingRowRank(windowKey: String, expectedRank: Int, actualRank: Int)
    case unorderedRankingRows(windowKey: String, previousRank: Int, previousReviewCount: Int, rank: Int, reviewCount: Int)
    case tooManyGapRows(windowKey: String, gapRowCount: Int)
    case viewerRowMismatch(windowKey: String)
    case viewerRankingRowMismatch(windowKey: String)

    var errorDescription: String? {
        switch self {
        case .unexpectedWindows(let status, let windowCount):
            return "Leaderboard with status \(status) must not contain windows. Received \(windowCount)."
        case .invalidWindowKeys(let windowKeys):
            return "Leaderboard window keys are invalid: \(windowKeys.joined(separator: ", "))."
        case .invalidTimestamp(let windowKey, let field, let value):
            return "Leaderboard window \(windowKey) contained an invalid \(field) timestamp: \(value)."
        case .negativeParticipantCount(let windowKey, let participantCount):
            return "Leaderboard window \(windowKey) contained a negative participant count: \(participantCount)."
        case .invalidViewerRank(let windowKey, let rank, let participantCount):
            return "Leaderboard window \(windowKey) viewer rank \(rank) is outside 1...\(participantCount)."
        case .negativeReviewCount(let windowKey, let reviewCount):
            return "Leaderboard window \(windowKey) contained a negative review count: \(reviewCount)."
        case .invalidRowRank(let windowKey, let rank):
            return "Leaderboard window \(windowKey) contained an invalid row rank: \(rank)."
        case .rankingRowCountMismatch(let windowKey, let participantCount, let rankingRowCount):
            return "Leaderboard window \(windowKey) participant count \(participantCount) did not match ranking row count \(rankingRowCount)."
        case .invalidRankingRowRank(let windowKey, let expectedRank, let actualRank):
            return "Leaderboard window \(windowKey) expected ranking row rank \(expectedRank), received \(actualRank)."
        case .unorderedRankingRows(let windowKey, let previousRank, let previousReviewCount, let rank, let reviewCount):
            return "Leaderboard window \(windowKey) ranking row \(rank) count \(reviewCount) exceeded previous rank \(previousRank) count \(previousReviewCount)."
        case .tooManyGapRows(let windowKey, let gapRowCount):
            return "Leaderboard window \(windowKey) contained \(gapRowCount) gap rows. At most \(progressLeaderboardMaximumGapRowCount) are allowed."
        case .viewerRowMismatch(let windowKey):
            return "Leaderboard window \(windowKey) rows did not contain exactly one viewer row matching the viewer."
        case .viewerRankingRowMismatch(let windowKey):
            return "Leaderboard window \(windowKey) ranking rows did not contain exactly one viewer row matching the viewer."
        }
    }
}

/// Refresh policy for a cached payload: ready payloads wait for the earliest
/// server-provided nextRefreshAfter, an unavailable snapshot retries on the next
/// pass, and the remaining placeholder statuses stay cached until invalidated.
func progressLeaderboardRequiresScheduledRefresh(
    leaderboard: UserProgressLeaderboard,
    now: Date
) -> Bool {
    switch leaderboard.status {
    case .ready:
        let nextRefreshDates = leaderboard.windows.compactMap { window in
            parseIsoTimestamp(value: window.nextRefreshAfter)
        }
        guard nextRefreshDates.count == leaderboard.windows.count,
              let earliestNextRefreshAfter = nextRefreshDates.min() else {
            return true
        }

        return now >= earliestNextRefreshAfter
    case .snapshotUnavailable:
        return true
    case .participationDisabled, .linkedAccountRequired:
        return false
    }
}

func validateProgressLeaderboard(leaderboard: UserProgressLeaderboard) throws {
    guard leaderboard.status == .ready else {
        guard leaderboard.windows.isEmpty else {
            throw ProgressLeaderboardValidationError.unexpectedWindows(
                status: leaderboard.status.rawValue,
                windowCount: leaderboard.windows.count
            )
        }

        return
    }

    let actualWindowKeys = leaderboard.windows.map(\.windowKey)
    guard actualWindowKeys == LeaderboardWindowKey.stableOrder else {
        throw ProgressLeaderboardValidationError.invalidWindowKeys(
            actualWindowKeys.map(\.rawValue)
        )
    }

    for window in leaderboard.windows {
        try validateProgressLeaderboardWindow(window: window)
    }
}

private func validateProgressLeaderboardWindow(window: ProgressLeaderboardWindow) throws {
    let windowKey = window.windowKey.rawValue
    let timestampFields: [(field: String, value: String)] = [
        ("snapshotGeneratedAt", window.snapshotGeneratedAt),
        ("asOfServerHour", window.asOfServerHour),
        ("nextRefreshAfter", window.nextRefreshAfter),
    ]
    for timestampField in timestampFields {
        guard parseIsoTimestamp(value: timestampField.value) != nil else {
            throw ProgressLeaderboardValidationError.invalidTimestamp(
                windowKey: windowKey,
                field: timestampField.field,
                value: timestampField.value
            )
        }
    }

    guard window.participantCount >= 0 else {
        throw ProgressLeaderboardValidationError.negativeParticipantCount(
            windowKey: windowKey,
            participantCount: window.participantCount
        )
    }

    guard window.viewer.rank >= 1, window.viewer.rank <= window.participantCount else {
        throw ProgressLeaderboardValidationError.invalidViewerRank(
            windowKey: windowKey,
            rank: window.viewer.rank,
            participantCount: window.participantCount
        )
    }

    guard window.viewer.qualifiedReviewCount >= 0 else {
        throw ProgressLeaderboardValidationError.negativeReviewCount(
            windowKey: windowKey,
            reviewCount: window.viewer.qualifiedReviewCount
        )
    }

    try validateProgressLeaderboardRankingRows(window: window)

    var viewerRows: [ProgressLeaderboardParticipantRow] = []
    var gapRowCount: Int = 0
    for row in window.rows {
        guard case .participant(let participantRow) = row else {
            gapRowCount += 1
            continue
        }

        guard participantRow.qualifiedReviewCount >= 0 else {
            throw ProgressLeaderboardValidationError.negativeReviewCount(
                windowKey: windowKey,
                reviewCount: participantRow.qualifiedReviewCount
            )
        }

        guard participantRow.rank >= 1 else {
            throw ProgressLeaderboardValidationError.invalidRowRank(
                windowKey: windowKey,
                rank: participantRow.rank
            )
        }

        if participantRow.kind == .viewer {
            viewerRows.append(participantRow)
        }
    }

    // The compact-row contract emits at most two ellipsis gaps; extras would
    // stretch the leaderboard beyond its reserved compact height.
    guard gapRowCount <= progressLeaderboardMaximumGapRowCount else {
        throw ProgressLeaderboardValidationError.tooManyGapRows(
            windowKey: windowKey,
            gapRowCount: gapRowCount
        )
    }

    guard
        viewerRows.count == 1,
        let viewerRow = viewerRows.first,
        viewerRow.publicProfileId == window.viewer.publicProfileId,
        viewerRow.rank == window.viewer.rank,
        viewerRow.qualifiedReviewCount == window.viewer.qualifiedReviewCount
    else {
        throw ProgressLeaderboardValidationError.viewerRowMismatch(windowKey: windowKey)
    }
}

private func validateProgressLeaderboardRankingRows(window: ProgressLeaderboardWindow) throws {
    let windowKey = window.windowKey.rawValue

    guard window.rankingRows.count == window.participantCount else {
        throw ProgressLeaderboardValidationError.rankingRowCountMismatch(
            windowKey: windowKey,
            participantCount: window.participantCount,
            rankingRowCount: window.rankingRows.count
        )
    }

    var viewerRows: [ProgressLeaderboardRankingRow] = []
    var previousRankingRow: ProgressLeaderboardRankingRow?
    for (index, rankingRow) in window.rankingRows.enumerated() {
        guard rankingRow.qualifiedReviewCount >= 0 else {
            throw ProgressLeaderboardValidationError.negativeReviewCount(
                windowKey: windowKey,
                reviewCount: rankingRow.qualifiedReviewCount
            )
        }

        let expectedRank = index + 1
        guard rankingRow.rank == expectedRank else {
            throw ProgressLeaderboardValidationError.invalidRankingRowRank(
                windowKey: windowKey,
                expectedRank: expectedRank,
                actualRank: rankingRow.rank
            )
        }

        if let previousRankingRow,
           rankingRow.qualifiedReviewCount > previousRankingRow.qualifiedReviewCount {
            throw ProgressLeaderboardValidationError.unorderedRankingRows(
                windowKey: windowKey,
                previousRank: previousRankingRow.rank,
                previousReviewCount: previousRankingRow.qualifiedReviewCount,
                rank: rankingRow.rank,
                reviewCount: rankingRow.qualifiedReviewCount
            )
        }

        if rankingRow.kind == .viewer {
            viewerRows.append(rankingRow)
        }

        previousRankingRow = rankingRow
    }

    guard
        viewerRows.count == 1,
        let viewerRow = viewerRows.first,
        viewerRow.publicProfileId == window.viewer.publicProfileId,
        viewerRow.rank == window.viewer.rank,
        viewerRow.qualifiedReviewCount == window.viewer.qualifiedReviewCount
    else {
        throw ProgressLeaderboardValidationError.viewerRankingRowMismatch(windowKey: windowKey)
    }
}
