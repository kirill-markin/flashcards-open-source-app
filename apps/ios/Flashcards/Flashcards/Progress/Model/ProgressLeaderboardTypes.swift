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

struct ProgressStreakLeaderboardViewer: Codable, Hashable, Sendable {
    let publicProfileId: String
    let displayName: String
    let rank: Int
    let streakDays: Int
}

struct ProgressStreakLeaderboardParticipantRow: Codable, Hashable, Sendable {
    let kind: ProgressLeaderboardParticipantKind
    let publicProfileId: String
    /// Server-generated from the public profile id and the request locale.
    /// Clients must never generate or persist their own anonymous names.
    let anonymousDisplayName: String
    /// Viewer-private friend label shown only for current opted-in friends.
    let friendDisplayName: String?
    let streakDays: Int
    let rank: Int
}

struct ProgressStreakLeaderboardRankingRow: Codable, Hashable, Sendable {
    let kind: ProgressLeaderboardRankingRowKind
    let publicProfileId: String
    /// Server-generated from the public profile id and the request locale.
    /// Clients must never generate or persist their own anonymous names.
    let anonymousDisplayName: String
    /// Viewer-private friend label shown only for current opted-in friends.
    let friendDisplayName: String?
    let streakDays: Int
    let rank: Int
}

enum ProgressStreakLeaderboardRow: Codable, Hashable, Sendable {
    case participant(ProgressStreakLeaderboardParticipantRow)
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

        self = .participant(try ProgressStreakLeaderboardParticipantRow(from: decoder))
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

struct ProgressStreakLeaderboardReadyPayload: Codable, Hashable, Sendable {
    let snapshotId: String
    let snapshotGeneratedAt: String
    let asOfUtcDate: String
    let nextRefreshAfter: String
    let participantCount: Int
    let viewer: ProgressStreakLeaderboardViewer
    let rows: [ProgressStreakLeaderboardRow]
    let rankingRows: [ProgressStreakLeaderboardRankingRow]
}

struct UserProgressStreakLeaderboard: Codable, Hashable, Sendable {
    let status: ProgressLeaderboardStatus
    let metric: ProgressLeaderboardMetric
    /// Present only when status is ready. Non-ready streak responses carry no rows.
    let readyPayload: ProgressStreakLeaderboardReadyPayload?

    private enum CodingKeys: String, CodingKey {
        case status
        case metric
        case snapshotId
        case snapshotGeneratedAt
        case asOfUtcDate
        case nextRefreshAfter
        case participantCount
        case viewer
        case rows
        case rankingRows
    }

    private static let readyPayloadCodingKeys: [CodingKeys] = [
        .snapshotId,
        .snapshotGeneratedAt,
        .asOfUtcDate,
        .nextRefreshAfter,
        .participantCount,
        .viewer,
        .rows,
        .rankingRows,
    ]

    init(
        status: ProgressLeaderboardStatus,
        metric: ProgressLeaderboardMetric,
        readyPayload: ProgressStreakLeaderboardReadyPayload?
    ) {
        self.status = status
        self.metric = metric
        self.readyPayload = readyPayload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(ProgressLeaderboardStatus.self, forKey: .status)
        let metric = try container.decode(ProgressLeaderboardMetric.self, forKey: .metric)
        let readyPayload: ProgressStreakLeaderboardReadyPayload?
        if status == .ready {
            readyPayload = ProgressStreakLeaderboardReadyPayload(
                snapshotId: try container.decode(String.self, forKey: .snapshotId),
                snapshotGeneratedAt: try container.decode(String.self, forKey: .snapshotGeneratedAt),
                asOfUtcDate: try container.decode(String.self, forKey: .asOfUtcDate),
                nextRefreshAfter: try container.decode(String.self, forKey: .nextRefreshAfter),
                participantCount: try container.decode(Int.self, forKey: .participantCount),
                viewer: try container.decode(ProgressStreakLeaderboardViewer.self, forKey: .viewer),
                rows: try container.decode([ProgressStreakLeaderboardRow].self, forKey: .rows),
                rankingRows: try container.decode([ProgressStreakLeaderboardRankingRow].self, forKey: .rankingRows)
            )
        } else {
            if let unexpectedKey = Self.readyPayloadCodingKeys.first(where: { key in container.contains(key) }) {
                throw DecodingError.dataCorruptedError(
                    forKey: unexpectedKey,
                    in: container,
                    debugDescription: "Non-ready streak leaderboard payload must not include \(unexpectedKey.stringValue)."
                )
            }
            readyPayload = nil
        }

        self.init(status: status, metric: metric, readyPayload: readyPayload)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.status, forKey: .status)
        try container.encode(self.metric, forKey: .metric)
        guard let readyPayload else {
            return
        }

        try container.encode(readyPayload.snapshotId, forKey: .snapshotId)
        try container.encode(readyPayload.snapshotGeneratedAt, forKey: .snapshotGeneratedAt)
        try container.encode(readyPayload.asOfUtcDate, forKey: .asOfUtcDate)
        try container.encode(readyPayload.nextRefreshAfter, forKey: .nextRefreshAfter)
        try container.encode(readyPayload.participantCount, forKey: .participantCount)
        try container.encode(readyPayload.viewer, forKey: .viewer)
        try container.encode(readyPayload.rows, forKey: .rows)
        try container.encode(readyPayload.rankingRows, forKey: .rankingRows)
    }
}

enum ProgressLeaderboardProfileStatus: String, Codable, Hashable, Sendable {
    case ready
    case linkedAccountRequired = "linked_account_required"
    case participationDisabled = "participation_disabled"
    case profileUnavailable = "profile_unavailable"
}

enum ProgressLeaderboardProfileReviewActivityDateBasis: String, Codable, Hashable, Sendable {
    case profileLocalDayWithUtcFallback = "profile_local_day_with_utc_fallback"
}

struct ProgressLeaderboardProfileBestRatingPlacement: Codable, Hashable, Sendable {
    let windowKey: LeaderboardWindowKey
    let rank: Int
}

struct ProgressLeaderboardProfileMetrics: Codable, Hashable, Sendable {
    let currentStreakDays: Int
    let bestRatingPlacement: ProgressLeaderboardProfileBestRatingPlacement?
}

struct ProgressLeaderboardProfileReviewActivityDay: Codable, Hashable, Sendable {
    let date: String
    let reviewCount: Int
}

struct ProgressLeaderboardProfileReviewActivity: Codable, Hashable, Sendable {
    let dateBasis: ProgressLeaderboardProfileReviewActivityDateBasis
    let days: [ProgressLeaderboardProfileReviewActivityDay]
}

struct ProgressLeaderboardProfileStats: Codable, Hashable, Sendable {
    let joinedAt: String
    let totalCards: Int
}

struct ProgressLeaderboardProfileReadyPayload: Codable, Hashable, Sendable {
    let publicProfileId: String
    let anonymousDisplayName: String
    let friendDisplayName: String?
    let isFriend: Bool
    let metrics: ProgressLeaderboardProfileMetrics
    let reviewActivity: ProgressLeaderboardProfileReviewActivity
    let stats: ProgressLeaderboardProfileStats
    let generatedAt: String
}

struct UserProgressLeaderboardProfile: Codable, Hashable, Sendable {
    let status: ProgressLeaderboardProfileStatus
    /// Present only when status is ready. Non-ready responses carry no profile details.
    let readyPayload: ProgressLeaderboardProfileReadyPayload?

    private enum CodingKeys: String, CodingKey {
        case status
        case publicProfileId
        case anonymousDisplayName
        case friendDisplayName
        case isFriend
        case metrics
        case reviewActivity
        case stats
        case generatedAt
    }

    private static let readyPayloadCodingKeys: [CodingKeys] = [
        .publicProfileId,
        .anonymousDisplayName,
        .friendDisplayName,
        .isFriend,
        .metrics,
        .reviewActivity,
        .stats,
        .generatedAt,
    ]

    init(
        status: ProgressLeaderboardProfileStatus,
        readyPayload: ProgressLeaderboardProfileReadyPayload?
    ) {
        self.status = status
        self.readyPayload = readyPayload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(ProgressLeaderboardProfileStatus.self, forKey: .status)
        let readyPayload: ProgressLeaderboardProfileReadyPayload?
        if status == .ready {
            readyPayload = ProgressLeaderboardProfileReadyPayload(
                publicProfileId: try container.decode(String.self, forKey: .publicProfileId),
                anonymousDisplayName: try container.decode(String.self, forKey: .anonymousDisplayName),
                friendDisplayName: try container.decodeIfPresent(String.self, forKey: .friendDisplayName),
                isFriend: try container.decode(Bool.self, forKey: .isFriend),
                metrics: try container.decode(ProgressLeaderboardProfileMetrics.self, forKey: .metrics),
                reviewActivity: try container.decode(
                    ProgressLeaderboardProfileReviewActivity.self,
                    forKey: .reviewActivity
                ),
                stats: try container.decode(ProgressLeaderboardProfileStats.self, forKey: .stats),
                generatedAt: try container.decode(String.self, forKey: .generatedAt)
            )
        } else {
            if let unexpectedKey = Self.readyPayloadCodingKeys.first(where: { key in container.contains(key) }) {
                throw DecodingError.dataCorruptedError(
                    forKey: unexpectedKey,
                    in: container,
                    debugDescription: "Non-ready leaderboard profile payload must not include \(unexpectedKey.stringValue)."
                )
            }
            readyPayload = nil
        }

        self.init(status: status, readyPayload: readyPayload)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.status, forKey: .status)
        guard let readyPayload else {
            return
        }

        try container.encode(readyPayload.publicProfileId, forKey: .publicProfileId)
        try container.encode(readyPayload.anonymousDisplayName, forKey: .anonymousDisplayName)
        try container.encodeIfPresent(readyPayload.friendDisplayName, forKey: .friendDisplayName)
        try container.encode(readyPayload.isFriend, forKey: .isFriend)
        try container.encode(readyPayload.metrics, forKey: .metrics)
        try container.encode(readyPayload.reviewActivity, forKey: .reviewActivity)
        try container.encode(readyPayload.stats, forKey: .stats)
        try container.encode(readyPayload.generatedAt, forKey: .generatedAt)
    }
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

enum ProgressStreakLeaderboardValidationError: LocalizedError {
    case missingReadyPayload
    case unexpectedReadyPayload(status: String)
    case invalidTimestamp(field: String, value: String)
    case invalidAsOfUtcDate(String)
    case negativeParticipantCount(Int)
    case invalidViewerRank(rank: Int, participantCount: Int)
    case negativeStreakDays(streakDays: Int)
    case invalidRowRank(rank: Int)
    case rankingRowCountMismatch(participantCount: Int, rankingRowCount: Int)
    case invalidRankingRowRank(expectedRank: Int, actualRank: Int)
    case unorderedRankingRows(previousRank: Int, previousStreakDays: Int, rank: Int, streakDays: Int)
    case viewerRowMismatch
    case viewerRankingRowMismatch

    var errorDescription: String? {
        switch self {
        case .missingReadyPayload:
            return "Streak leaderboard with ready status must contain a ready payload."
        case .unexpectedReadyPayload(let status):
            return "Streak leaderboard with status \(status) must not contain a ready payload."
        case .invalidTimestamp(let field, let value):
            return "Streak leaderboard contained an invalid \(field) timestamp: \(value)."
        case .invalidAsOfUtcDate(let value):
            return "Streak leaderboard contained an invalid asOfUtcDate value: \(value)."
        case .negativeParticipantCount(let participantCount):
            return "Streak leaderboard contained a negative participant count: \(participantCount)."
        case .invalidViewerRank(let rank, let participantCount):
            return "Streak leaderboard viewer rank \(rank) is outside 1...\(participantCount)."
        case .negativeStreakDays(let streakDays):
            return "Streak leaderboard contained a negative streakDays value: \(streakDays)."
        case .invalidRowRank(let rank):
            return "Streak leaderboard contained an invalid row rank: \(rank)."
        case .rankingRowCountMismatch(let participantCount, let rankingRowCount):
            return "Streak leaderboard participant count \(participantCount) did not match ranking row count \(rankingRowCount)."
        case .invalidRankingRowRank(let expectedRank, let actualRank):
            return "Streak leaderboard expected ranking row rank \(expectedRank), received \(actualRank)."
        case .unorderedRankingRows(let previousRank, let previousStreakDays, let rank, let streakDays):
            return "Streak leaderboard ranking row \(rank) streak \(streakDays) exceeded previous rank \(previousRank) streak \(previousStreakDays)."
        case .viewerRowMismatch:
            return "Streak leaderboard rows did not contain exactly one viewer row matching the viewer."
        case .viewerRankingRowMismatch:
            return "Streak leaderboard ranking rows did not contain exactly one viewer row matching the viewer."
        }
    }
}

enum ProgressLeaderboardProfileValidationError: LocalizedError {
    case missingReadyPayload
    case unexpectedReadyPayload(status: String)
    case publicProfileIdMismatch(expected: String, actual: String)
    case emptyPublicProfileId
    case emptyAnonymousDisplayName
    case emptyFriendDisplayName
    case negativeCurrentStreakDays(Int)
    case invalidBestRatingRank(Int)
    case invalidReviewActivityDayCount(Int)
    case invalidReviewActivityDate(String)
    case duplicateReviewActivityDate(String)
    case negativeReviewCount(date: String, reviewCount: Int)
    case invalidJoinedAt(String)
    case negativeTotalCards(Int)
    case invalidGeneratedAt(String)

    var errorDescription: String? {
        switch self {
        case .missingReadyPayload:
            return "Leaderboard profile with ready status must contain a ready payload."
        case .unexpectedReadyPayload(let status):
            return "Leaderboard profile with status \(status) must not contain a ready payload."
        case .publicProfileIdMismatch(let expected, let actual):
            return "Leaderboard profile id mismatch. Expected \(expected), received \(actual)."
        case .emptyPublicProfileId:
            return "Leaderboard profile publicProfileId must not be empty."
        case .emptyAnonymousDisplayName:
            return "Leaderboard profile anonymousDisplayName must not be empty."
        case .emptyFriendDisplayName:
            return "Leaderboard profile friendDisplayName must not be empty when present."
        case .negativeCurrentStreakDays(let currentStreakDays):
            return "Leaderboard profile currentStreakDays must not be negative: \(currentStreakDays)."
        case .invalidBestRatingRank(let rank):
            return "Leaderboard profile best rating rank must be at least 1. Received \(rank)."
        case .invalidReviewActivityDayCount(let dayCount):
            return "Leaderboard profile reviewActivity.days must contain exactly 30 days. Received \(dayCount)."
        case .invalidReviewActivityDate(let date):
            return "Leaderboard profile review activity date is invalid: \(date)."
        case .duplicateReviewActivityDate(let date):
            return "Leaderboard profile review activity date is duplicated: \(date)."
        case .negativeReviewCount(let date, let reviewCount):
            return "Leaderboard profile review count for \(date) must not be negative: \(reviewCount)."
        case .invalidJoinedAt(let joinedAt):
            return "Leaderboard profile joinedAt timestamp is invalid: \(joinedAt)."
        case .negativeTotalCards(let totalCards):
            return "Leaderboard profile totalCards must not be negative: \(totalCards)."
        case .invalidGeneratedAt(let generatedAt):
            return "Leaderboard profile generatedAt timestamp is invalid: \(generatedAt)."
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

func progressStreakLeaderboardRequiresScheduledRefresh(
    leaderboard: UserProgressStreakLeaderboard,
    now: Date
) -> Bool {
    switch leaderboard.status {
    case .ready:
        guard let readyPayload = leaderboard.readyPayload,
              let nextRefreshAfter = parseIsoTimestamp(value: readyPayload.nextRefreshAfter) else {
            return true
        }

        return now >= nextRefreshAfter
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

func validateProgressStreakLeaderboard(leaderboard: UserProgressStreakLeaderboard) throws {
    guard leaderboard.status == .ready else {
        guard leaderboard.readyPayload == nil else {
            throw ProgressStreakLeaderboardValidationError.unexpectedReadyPayload(
                status: leaderboard.status.rawValue
            )
        }

        return
    }

    guard let readyPayload = leaderboard.readyPayload else {
        throw ProgressStreakLeaderboardValidationError.missingReadyPayload
    }

    try validateProgressStreakLeaderboardReadyPayload(readyPayload: readyPayload)
}

private func validateProgressStreakLeaderboardReadyPayload(
    readyPayload: ProgressStreakLeaderboardReadyPayload
) throws {
    let timestampFields: [(field: String, value: String)] = [
        ("snapshotGeneratedAt", readyPayload.snapshotGeneratedAt),
        ("nextRefreshAfter", readyPayload.nextRefreshAfter),
    ]
    for timestampField in timestampFields {
        guard parseIsoTimestamp(value: timestampField.value) != nil else {
            throw ProgressStreakLeaderboardValidationError.invalidTimestamp(
                field: timestampField.field,
                value: timestampField.value
            )
        }
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard progressStrictDate(localDate: readyPayload.asOfUtcDate, calendar: calendar) != nil else {
        throw ProgressStreakLeaderboardValidationError.invalidAsOfUtcDate(readyPayload.asOfUtcDate)
    }

    guard readyPayload.participantCount >= 0 else {
        throw ProgressStreakLeaderboardValidationError.negativeParticipantCount(readyPayload.participantCount)
    }

    guard readyPayload.viewer.rank >= 1, readyPayload.viewer.rank <= readyPayload.participantCount else {
        throw ProgressStreakLeaderboardValidationError.invalidViewerRank(
            rank: readyPayload.viewer.rank,
            participantCount: readyPayload.participantCount
        )
    }

    guard readyPayload.viewer.streakDays >= 0 else {
        throw ProgressStreakLeaderboardValidationError.negativeStreakDays(
            streakDays: readyPayload.viewer.streakDays
        )
    }

    try validateProgressStreakLeaderboardRankingRows(readyPayload: readyPayload)

    var viewerRows: [ProgressStreakLeaderboardParticipantRow] = []
    for row in readyPayload.rows {
        guard case .participant(let participantRow) = row else {
            continue
        }

        guard participantRow.streakDays >= 0 else {
            throw ProgressStreakLeaderboardValidationError.negativeStreakDays(
                streakDays: participantRow.streakDays
            )
        }

        guard participantRow.rank >= 1 else {
            throw ProgressStreakLeaderboardValidationError.invalidRowRank(rank: participantRow.rank)
        }

        if participantRow.kind == .viewer {
            viewerRows.append(participantRow)
        }
    }

    guard
        viewerRows.count == 1,
        let viewerRow = viewerRows.first,
        viewerRow.publicProfileId == readyPayload.viewer.publicProfileId,
        viewerRow.rank == readyPayload.viewer.rank,
        viewerRow.streakDays == readyPayload.viewer.streakDays
    else {
        throw ProgressStreakLeaderboardValidationError.viewerRowMismatch
    }
}

func validateProgressLeaderboardProfile(
    profile: UserProgressLeaderboardProfile,
    expectedPublicProfileId: String
) throws {
    switch profile.status {
    case .ready:
        guard let readyPayload = profile.readyPayload else {
            throw ProgressLeaderboardProfileValidationError.missingReadyPayload
        }

        try validateProgressLeaderboardProfileReadyPayload(
            payload: readyPayload,
            expectedPublicProfileId: expectedPublicProfileId
        )
    case .linkedAccountRequired, .participationDisabled, .profileUnavailable:
        guard profile.readyPayload == nil else {
            throw ProgressLeaderboardProfileValidationError.unexpectedReadyPayload(
                status: profile.status.rawValue
            )
        }
    }
}

private func validateProgressLeaderboardProfileReadyPayload(
    payload: ProgressLeaderboardProfileReadyPayload,
    expectedPublicProfileId: String
) throws {
    guard payload.publicProfileId == expectedPublicProfileId else {
        throw ProgressLeaderboardProfileValidationError.publicProfileIdMismatch(
            expected: expectedPublicProfileId,
            actual: payload.publicProfileId
        )
    }

    guard payload.publicProfileId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        throw ProgressLeaderboardProfileValidationError.emptyPublicProfileId
    }

    guard payload.anonymousDisplayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        throw ProgressLeaderboardProfileValidationError.emptyAnonymousDisplayName
    }

    if let friendDisplayName = payload.friendDisplayName {
        guard friendDisplayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            throw ProgressLeaderboardProfileValidationError.emptyFriendDisplayName
        }
    }

    guard payload.metrics.currentStreakDays >= 0 else {
        throw ProgressLeaderboardProfileValidationError.negativeCurrentStreakDays(
            payload.metrics.currentStreakDays
        )
    }

    if let bestRatingPlacement = payload.metrics.bestRatingPlacement {
        guard bestRatingPlacement.rank >= 1 else {
            throw ProgressLeaderboardProfileValidationError.invalidBestRatingRank(bestRatingPlacement.rank)
        }
    }

    try validateProgressLeaderboardProfileReviewActivity(activity: payload.reviewActivity)

    guard parseIsoTimestamp(value: payload.stats.joinedAt) != nil else {
        throw ProgressLeaderboardProfileValidationError.invalidJoinedAt(payload.stats.joinedAt)
    }

    guard payload.stats.totalCards >= 0 else {
        throw ProgressLeaderboardProfileValidationError.negativeTotalCards(payload.stats.totalCards)
    }

    guard parseIsoTimestamp(value: payload.generatedAt) != nil else {
        throw ProgressLeaderboardProfileValidationError.invalidGeneratedAt(payload.generatedAt)
    }
}

private func validateProgressLeaderboardProfileReviewActivity(
    activity: ProgressLeaderboardProfileReviewActivity
) throws {
    guard activity.days.count == 30 else {
        throw ProgressLeaderboardProfileValidationError.invalidReviewActivityDayCount(activity.days.count)
    }

    let calendar = Calendar(identifier: .gregorian)
    var seenDates: Set<String> = []
    for day in activity.days {
        guard (try? progressDate(localDate: day.date, calendar: calendar)) != nil else {
            throw ProgressLeaderboardProfileValidationError.invalidReviewActivityDate(day.date)
        }
        guard seenDates.insert(day.date).inserted else {
            throw ProgressLeaderboardProfileValidationError.duplicateReviewActivityDate(day.date)
        }
        guard day.reviewCount >= 0 else {
            throw ProgressLeaderboardProfileValidationError.negativeReviewCount(
                date: day.date,
                reviewCount: day.reviewCount
            )
        }
    }
}

private func validateProgressStreakLeaderboardRankingRows(
    readyPayload: ProgressStreakLeaderboardReadyPayload
) throws {
    guard readyPayload.rankingRows.count == readyPayload.participantCount else {
        throw ProgressStreakLeaderboardValidationError.rankingRowCountMismatch(
            participantCount: readyPayload.participantCount,
            rankingRowCount: readyPayload.rankingRows.count
        )
    }

    var viewerRows: [ProgressStreakLeaderboardRankingRow] = []
    var previousRankingRow: ProgressStreakLeaderboardRankingRow?
    for (index, rankingRow) in readyPayload.rankingRows.enumerated() {
        guard rankingRow.streakDays >= 0 else {
            throw ProgressStreakLeaderboardValidationError.negativeStreakDays(
                streakDays: rankingRow.streakDays
            )
        }

        let expectedRank = index + 1
        guard rankingRow.rank == expectedRank else {
            throw ProgressStreakLeaderboardValidationError.invalidRankingRowRank(
                expectedRank: expectedRank,
                actualRank: rankingRow.rank
            )
        }

        if let previousRankingRow,
           rankingRow.streakDays > previousRankingRow.streakDays {
            throw ProgressStreakLeaderboardValidationError.unorderedRankingRows(
                previousRank: previousRankingRow.rank,
                previousStreakDays: previousRankingRow.streakDays,
                rank: rankingRow.rank,
                streakDays: rankingRow.streakDays
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
        viewerRow.publicProfileId == readyPayload.viewer.publicProfileId,
        viewerRow.rank == readyPayload.viewer.rank,
        viewerRow.streakDays == readyPayload.viewer.streakDays
    else {
        throw ProgressStreakLeaderboardValidationError.viewerRankingRowMismatch
    }
}
