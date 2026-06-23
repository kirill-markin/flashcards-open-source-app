import Foundation
import XCTest
@testable import Flashcards

let progressSnapshotFactoryScopeKey = makeProgressLeaderboardScopeKeyForTests()

func makeProgressSnapshotFactoryCompactRows() -> [ProgressLeaderboardRow] {
    [
        makeProgressLeaderboardParticipantRowForTests(
            kind: .top,
            publicProfileId: "profile-top-1",
            anonymousDisplayName: "Silver Bright Harbor",
            qualifiedReviewCount: 51,
            rank: 1
        ),
        makeProgressLeaderboardParticipantRowForTests(
            kind: .top,
            publicProfileId: "profile-top-2",
            anonymousDisplayName: "Amber Calm Meadow",
            qualifiedReviewCount: 44,
            rank: 2
        ),
        makeProgressLeaderboardParticipantRowForTests(
            kind: .top,
            publicProfileId: "profile-top-3",
            anonymousDisplayName: "Coral Keen Valley",
            qualifiedReviewCount: 39,
            rank: 3
        ),
        .gap,
        makeProgressLeaderboardParticipantRowForTests(
            kind: .neighbor,
            publicProfileId: "profile-neighbor-41",
            anonymousDisplayName: "Jade Swift River",
            qualifiedReviewCount: 8,
            rank: 41
        ),
        makeProgressLeaderboardParticipantRowForTests(
            kind: .viewer,
            publicProfileId: "profile-viewer",
            anonymousDisplayName: "Indigo Quiet Field",
            qualifiedReviewCount: 7,
            rank: 42
        ),
        makeProgressLeaderboardParticipantRowForTests(
            kind: .neighbor,
            publicProfileId: "profile-neighbor-43",
            anonymousDisplayName: "Lilac Bold Summit",
            qualifiedReviewCount: 6,
            rank: 43
        ),
        .gap,
        makeProgressLeaderboardParticipantRowForTests(
            kind: .neighbor,
            publicProfileId: "profile-last-128",
            anonymousDisplayName: "Blue Final Harbor",
            qualifiedReviewCount: 0,
            rank: 128
        ),
    ]
}

func makeProgressSnapshotFactoryRankingRows() -> [ProgressLeaderboardRankingRow] {
    (1...128).map { rank in
        switch rank {
        case 1:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-top-1",
                anonymousDisplayName: "Silver Bright Harbor",
                qualifiedReviewCount: 51,
                rank: rank
            )
        case 2:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-top-2",
                anonymousDisplayName: "Amber Calm Meadow",
                qualifiedReviewCount: 44,
                rank: rank
            )
        case 3:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-top-3",
                anonymousDisplayName: "Coral Keen Valley",
                qualifiedReviewCount: 39,
                rank: rank
            )
        case 4...40:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-mid-\(rank)",
                anonymousDisplayName: "Rank \(rank)",
                qualifiedReviewCount: 9,
                rank: rank
            )
        case 41:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-neighbor-41",
                anonymousDisplayName: "Jade Swift River",
                qualifiedReviewCount: 8,
                rank: rank
            )
        case 42:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .viewer,
                publicProfileId: "profile-viewer",
                anonymousDisplayName: "Indigo Quiet Field",
                qualifiedReviewCount: 7,
                rank: rank
            )
        case 43:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-neighbor-43",
                anonymousDisplayName: "Lilac Bold Summit",
                qualifiedReviewCount: 6,
                rank: rank
            )
        case 44...127:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-tail-\(rank)",
                anonymousDisplayName: "Rank \(rank)",
                qualifiedReviewCount: 1,
                rank: rank
            )
        case 128:
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-last-128",
                anonymousDisplayName: "Blue Final Harbor",
                qualifiedReviewCount: 0,
                rank: rank
            )
        default:
            XCTFail("Unexpected leaderboard rank \(rank)")
            return makeProgressLeaderboardRankingRowForTests(
                kind: .participant,
                publicProfileId: "profile-invalid-\(rank)",
                anonymousDisplayName: "Invalid Rank",
                qualifiedReviewCount: 0,
                rank: rank
            )
        }
    }
}

func makeProgressSnapshotFactoryViewer() -> ProgressLeaderboardViewer {
    ProgressLeaderboardViewer(
        publicProfileId: "profile-viewer",
        displayName: "You",
        rank: 42,
        qualifiedReviewCount: 7
    )
}

func makeProgressSnapshotFactoryReadyLeaderboardState(
    viewerRanksByWindow: [LeaderboardWindowKey: Int]
) -> ProgressLeaderboardReadyState {
    ProgressLeaderboardReadyState(
        defaultWindowKey: .last24Hours,
        windows: LeaderboardWindowKey.stableOrder.map { windowKey in
            ProgressLeaderboardWindowState(
                windowKey: windowKey,
                snapshotGeneratedAt: "2026-06-10T14:00:05.000Z",
                participantCount: 128,
                viewerRank: viewerRanksByWindow[windowKey] ?? 42,
                viewerQualifiedReviewCount: 7,
                rows: []
            )
        }
    )
}

func expectedProgressSnapshotFactoryLeaderboardUpdatedText(elapsedText: String) -> String {
    let localizedFormat = String(
        localized: "progress.screen.leaderboard.updated_at",
        defaultValue: "Updated %@ ago",
        table: progressStringsTableName,
        comment: "Progress leaderboard freshness text with localized elapsed time"
    )
    return String(format: localizedFormat, locale: Locale.current, elapsedText)
}

func expectedProgressSnapshotFactoryLeaderboardElapsedHourText(hours: Int64) -> String {
    if hours == 1 {
        return String(
            localized: "progress.screen.leaderboard.updated_at.hour.one",
            defaultValue: "1 hour",
            table: progressStringsTableName,
            comment: "Progress leaderboard freshness singular elapsed hour"
        )
    }

    let localizedFormat = String(
        localized: "progress.screen.leaderboard.updated_at.hour.other",
        defaultValue: "%lld hours",
        table: progressStringsTableName,
        comment: "Progress leaderboard freshness plural elapsed hours"
    )
    return String(format: localizedFormat, locale: Locale.current, hours)
}

func expectedProgressSnapshotFactoryLeaderboardElapsedMinuteText(minutes: Int64) -> String {
    if minutes == 1 {
        return String(
            localized: "progress.screen.leaderboard.updated_at.minute.one",
            defaultValue: "1 minute",
            table: progressStringsTableName,
            comment: "Progress leaderboard freshness singular elapsed minute"
        )
    }

    let localizedFormat = String(
        localized: "progress.screen.leaderboard.updated_at.minute.other",
        defaultValue: "%lld minutes",
        table: progressStringsTableName,
        comment: "Progress leaderboard freshness plural elapsed minutes"
    )
    return String(format: localizedFormat, locale: Locale.current, minutes)
}

func expectedProgressSnapshotFactoryLeaderboardElapsedHoursMinutesText(
    hours: Int64,
    minutes: Int64
) -> String {
    let localizedFormat = String(
        localized: "progress.screen.leaderboard.updated_at.elapsed.hours_minutes",
        defaultValue: "%1$@ %2$@",
        table: progressStringsTableName,
        comment: "Progress leaderboard freshness elapsed time with hours and remaining minutes"
    )
    return String(
        format: localizedFormat,
        locale: Locale.current,
        expectedProgressSnapshotFactoryLeaderboardElapsedHourText(hours: hours),
        expectedProgressSnapshotFactoryLeaderboardElapsedMinuteText(minutes: minutes)
    )
}
