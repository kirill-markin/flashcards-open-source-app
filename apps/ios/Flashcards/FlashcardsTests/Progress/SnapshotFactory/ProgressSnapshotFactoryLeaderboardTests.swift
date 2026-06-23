import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotFactoryLeaderboardTests: XCTestCase {
    func testStreakLeaderboardProjectionUsesPersonalStreakAndViewerWinsTies() throws {
        let leaderboard = makeReadyProgressStreakLeaderboardForTests(
            participantCount: 4,
            viewer: ProgressStreakLeaderboardViewer(
                publicProfileId: "profile-viewer",
                displayName: "You",
                rank: 3,
                streakDays: 3
            ),
            rows: [
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .top,
                    publicProfileId: "profile-top",
                    anonymousDisplayName: "Silver Bright Harbor",
                    streakDays: 8,
                    rank: 1
                ),
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .top,
                    publicProfileId: "profile-peer",
                    anonymousDisplayName: "Amber Calm Meadow",
                    streakDays: 5,
                    rank: 2
                ),
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 3,
                    rank: 3
                ),
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .neighbor,
                    publicProfileId: "profile-tail",
                    anonymousDisplayName: "Blue Final Harbor",
                    streakDays: 1,
                    rank: 4
                ),
            ],
            rankingRows: [
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: "profile-top",
                    anonymousDisplayName: "Silver Bright Harbor",
                    streakDays: 8,
                    rank: 1
                ),
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: "profile-peer",
                    anonymousDisplayName: "Amber Calm Meadow",
                    streakDays: 5,
                    rank: 2
                ),
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 3,
                    rank: 3
                ),
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: "profile-tail",
                    anonymousDisplayName: "Blue Final Harbor",
                    streakDays: 1,
                    rank: 4
                ),
            ],
            snapshotGeneratedAt: "2026-06-10T12:00:05.000Z",
            nextRefreshAfter: "2026-06-11T12:00:00.000Z"
        )

        let snapshot = try makeProgressStreakLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
            personalStreakDays: 5
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready streak leaderboard state, received \(snapshot.state)")
            return
        }

        XCTAssertEqual(4, readyState.participantCount)
        XCTAssertEqual(2, readyState.viewerRank)
        XCTAssertEqual(5, readyState.viewerStreakDays)

        let participantRows = readyState.rows.compactMap { row -> ProgressStreakLeaderboardParticipantRowState? in
            guard case .participant(let participantRow) = row else {
                return nil
            }

            return participantRow
        }
        let viewerRow = try XCTUnwrap(participantRows.first { row in
            row.kind == .viewer
        })
        let tiedPeerRow = try XCTUnwrap(participantRows.first { row in
            row.publicProfileId == "profile-peer"
        })

        XCTAssertEqual(2, viewerRow.rank)
        XCTAssertEqual(5, viewerRow.streakDays)
        XCTAssertEqual(3, tiedPeerRow.rank)
        XCTAssertEqual(5, tiedPeerRow.streakDays)
    }

    func testStreakLeaderboardAcceptsMultipleGapRowsForSeparatedParticipantRows() throws {
        let viewerRank = 16
        let rankingRows = (1...24).map { rank in
            makeProgressStreakLeaderboardRankingRowForTests(
                kind: rank == viewerRank ? .viewer : .participant,
                publicProfileId: rank == viewerRank ? "profile-viewer" : "profile-\(rank)",
                anonymousDisplayName: rank == viewerRank ? "Indigo Quiet Field" : "Rank \(rank)",
                streakDays: 25 - rank,
                rank: rank
            )
        }
        let leaderboard = makeReadyProgressStreakLeaderboardForTests(
            participantCount: 24,
            viewer: ProgressStreakLeaderboardViewer(
                publicProfileId: "profile-viewer",
                displayName: "You",
                rank: viewerRank,
                streakDays: 9
            ),
            rows: [
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .top,
                    publicProfileId: "profile-1",
                    anonymousDisplayName: "Rank 1",
                    streakDays: 24,
                    rank: 1
                ),
                .gap,
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .neighbor,
                    publicProfileId: "profile-8",
                    anonymousDisplayName: "Rank 8",
                    streakDays: 17,
                    rank: 8
                ),
                .gap,
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 9,
                    rank: viewerRank
                ),
                .gap,
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .neighbor,
                    publicProfileId: "profile-24",
                    anonymousDisplayName: "Rank 24",
                    streakDays: 1,
                    rank: 24
                ),
            ],
            rankingRows: rankingRows,
            snapshotGeneratedAt: "2026-06-10T12:00:05.000Z",
            nextRefreshAfter: "2026-06-11T12:00:00.000Z"
        )

        try validateProgressStreakLeaderboard(leaderboard: leaderboard)
        let snapshot = try makeProgressStreakLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
            personalStreakDays: nil
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready streak leaderboard state, received \(snapshot.state)")
            return
        }

        XCTAssertEqual(viewerRank, readyState.viewerRank)
        XCTAssertEqual(9, readyState.viewerStreakDays)
    }

    func testStreakLeaderboardUsesPersonalViewerRowWithoutReadyServerPayload() throws {
        let missingServerSnapshot = try makeProgressStreakLeaderboardSnapshot(
            leaderboard: nil,
            scopeKey: progressSnapshotFactoryScopeKey,
            personalStreakDays: 12
        )
        let unavailableServerSnapshot = try makeProgressStreakLeaderboardSnapshot(
            leaderboard: makeNonReadyProgressStreakLeaderboardForTests(status: .snapshotUnavailable),
            scopeKey: progressSnapshotFactoryScopeKey,
            personalStreakDays: 12
        )

        for snapshot in [missingServerSnapshot, unavailableServerSnapshot] {
            guard case .ready(let readyState) = snapshot.state else {
                XCTFail("Expected ready local streak leaderboard state, received \(snapshot.state)")
                return
            }

            XCTAssertNil(readyState.snapshotGeneratedAt)
            XCTAssertNil(readyState.asOfUtcDate)
            XCTAssertEqual(1, readyState.participantCount)
            XCTAssertEqual(1, readyState.viewerRank)
            XCTAssertEqual(12, readyState.viewerStreakDays)
            XCTAssertEqual(1, readyState.rows.count)

            guard case .participant(let viewerRow) = readyState.rows[0] else {
                XCTFail("Expected local viewer row, received \(readyState.rows[0])")
                return
            }

            XCTAssertEqual(.viewer, viewerRow.kind)
            XCTAssertNil(viewerRow.publicProfileId)
            XCTAssertEqual(12, viewerRow.streakDays)
            XCTAssertEqual(1, viewerRow.rank)
        }
    }

    func testBestLeaderboardPlacementChoosesLowestViewerRank() throws {
        let readyState = makeProgressSnapshotFactoryReadyLeaderboardState(
            viewerRanksByWindow: [
                .last24Hours: 7,
                .last3Days: 4,
                .last7Days: 2,
                .last30Days: 5,
                .allTime: 3,
            ]
        )

        let placement = try XCTUnwrap(resolveBestLeaderboardPlacement(readyState: readyState))

        XCTAssertEqual(.last7Days, placement.windowKey)
        XCTAssertEqual(2, placement.rank)
    }

    func testBestLeaderboardPlacementTiesChooseShortestWindow() throws {
        let readyState = makeProgressSnapshotFactoryReadyLeaderboardState(
            viewerRanksByWindow: [
                .last24Hours: 4,
                .last3Days: 2,
                .last7Days: 2,
                .last30Days: 3,
                .allTime: 2,
            ]
        )

        let placement = try XCTUnwrap(resolveBestLeaderboardPlacement(readyState: readyState))

        XCTAssertEqual(.last3Days, placement.windowKey)
        XCTAssertEqual(2, placement.rank)
    }

    func testReviewLeaderboardBadgeStateUsesBestReadyPlacementAndHidesUnknownRank() {
        let unknownSnapshot = ProgressLeaderboardSnapshot(
            scopeKey: progressSnapshotFactoryScopeKey,
            state: .awaitingServerData
        )
        XCTAssertEqual(
            makeEmptyReviewLeaderboardBadgeState(),
            makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: unknownSnapshot)
        )

        let readySnapshot = ProgressLeaderboardSnapshot(
            scopeKey: progressSnapshotFactoryScopeKey,
            state: .ready(
                makeProgressSnapshotFactoryReadyLeaderboardState(
                    viewerRanksByWindow: [
                        .last24Hours: 3,
                        .last3Days: 5,
                        .last7Days: 4,
                        .last30Days: 2,
                        .allTime: 2,
                    ]
                )
            )
        )

        XCTAssertEqual(
            ReviewLeaderboardBadgeState(
                rank: 2,
                windowKey: .last30Days,
                isInteractive: true
            ),
            makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: readySnapshot)
        )
    }

    func testStreakFreezeEvaluatorMarksTodayPendingWithoutSpendingFreeze() throws {
        let evaluation = try evaluateProgressStreakFreeze(
            sortedActiveReviewLocalDates: ["2026-04-16"],
            today: "2026-04-18",
            policy: progressStreakFreezePolicy
        )

        XCTAssertEqual(2, evaluation.currentStreakDays)
        XCTAssertEqual(2, evaluation.longestStreakDays)
        XCTAssertEqual(1, evaluation.streakFreeze.availableCredits)
        XCTAssertEqual(11, evaluation.streakFreeze.balanceUnits)
        XCTAssertEqual(
            [
                ProgressStreakDay(date: "2026-04-16", state: .reviewed),
                ProgressStreakDay(date: "2026-04-17", state: .frozen),
                ProgressStreakDay(date: "2026-04-18", state: .pending),
            ],
            evaluation.streakDays
        )
    }

    func testStreakFreezeEvaluatorResetsGapLargerThanAvailableFreezes() throws {
        let evaluation = try evaluateProgressStreakFreeze(
            sortedActiveReviewLocalDates: ["2026-04-12", "2026-04-18"],
            today: "2026-04-18",
            policy: progressStreakFreezePolicy
        )

        XCTAssertEqual(1, evaluation.currentStreakDays)
        XCTAssertEqual(3, evaluation.longestStreakDays)
        XCTAssertEqual(2, evaluation.streakFreeze.availableCredits)
        XCTAssertEqual(
            [
                ProgressStreakDay(date: "2026-04-12", state: .reviewed),
                ProgressStreakDay(date: "2026-04-13", state: .frozen),
                ProgressStreakDay(date: "2026-04-14", state: .frozen),
                ProgressStreakDay(date: "2026-04-15", state: .missed),
                ProgressStreakDay(date: "2026-04-16", state: .missed),
                ProgressStreakDay(date: "2026-04-17", state: .missed),
                ProgressStreakDay(date: "2026-04-18", state: .reviewed),
            ],
            evaluation.streakDays
        )
    }

    func testLiveOverlayReranksOnlyViewerFromRankingRows() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: makeProgressSnapshotFactoryRankingRows()
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))
        let qualifiedReviewEvents = (0 ..< 9).map { index in
            ProgressQualifiedReviewEventSource(
                reviewEventId: "review-event-\(index)",
                reviewedAtClient: "2026-06-10T14:30:00.000Z"
            )
        }

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
            canonicalQualifiedReviewEvents: qualifiedReviewEvents,
            // Locally submitted events exist in both sources; the overlay must
            // deduplicate them by review event id instead of double counting.
            pendingQualifiedReviewEvents: Array(qualifiedReviewEvents.prefix(3)),
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        for window in readyState.windows {
            XCTAssertEqual(9, window.viewerQualifiedReviewCount)
            XCTAssertEqual(41, window.viewerRank)
            XCTAssertEqual(128, window.participantCount)

            let participantRows = window.rows.compactMap { row -> ProgressLeaderboardParticipantRowState? in
                guard case .participant(let participantRow) = row else {
                    return nil
                }

                return participantRow
            }
            let viewerRow = try XCTUnwrap(participantRows.first { row in
                row.kind == .viewer
            })
            let promotedNeighborRow = try XCTUnwrap(participantRows.first { row in
                row.rank == 42
            })

            XCTAssertEqual(9, viewerRow.qualifiedReviewCount)
            XCTAssertEqual(41, viewerRow.rank)
            XCTAssertEqual("profile-viewer", viewerRow.publicProfileId)
            XCTAssertEqual("profile-neighbor-41", promotedNeighborRow.publicProfileId)
            XCTAssertEqual(8, promotedNeighborRow.qualifiedReviewCount)
        }
    }

    func testFactoryRecomputesDefaultWindowKeyFromProjectedRanks() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: makeProgressSnapshotFactoryRankingRows()
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))
        let qualifiedReviewEvents = (0 ..< 40).map { index in
            ProgressQualifiedReviewEventSource(
                reviewEventId: "review-event-\(index)",
                reviewedAtClient: "2026-06-08T15:00:00.000Z"
            )
        }

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
            canonicalQualifiedReviewEvents: qualifiedReviewEvents,
            pendingQualifiedReviewEvents: [],
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        let last24HoursWindow = try XCTUnwrap(readyState.windows.first { window in
            window.windowKey == .last24Hours
        })
        let last3DaysWindow = try XCTUnwrap(readyState.windows.first { window in
            window.windowKey == .last3Days
        })
        let badgeState = makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: snapshot)

        XCTAssertEqual(.last3Days, readyState.defaultWindowKey)
        XCTAssertEqual(42, last24HoursWindow.viewerRank)
        XCTAssertEqual(3, last3DaysWindow.viewerRank)
        XCTAssertEqual(
            ReviewLeaderboardBadgeState(
                rank: 3,
                windowKey: .last3Days,
                isInteractive: true
            ),
            badgeState
        )
    }

    func testLiveOverlayNeverLowersServerViewerCount() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: makeProgressSnapshotFactoryRankingRows()
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))
        let qualifiedReviewEvents = (0 ..< 2).map { index in
            ProgressQualifiedReviewEventSource(
                reviewEventId: "review-event-\(index)",
                reviewedAtClient: "2026-06-10T14:30:00.000Z"
            )
        }

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
            canonicalQualifiedReviewEvents: qualifiedReviewEvents,
            pendingQualifiedReviewEvents: [],
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        for window in readyState.windows {
            XCTAssertEqual(7, window.viewerQualifiedReviewCount)
            XCTAssertEqual(42, window.viewerRank)
        }
    }
}
