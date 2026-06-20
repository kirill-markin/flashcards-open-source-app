import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotFactoryTests: XCTestCase {
    private let scopeKey = makeProgressLeaderboardScopeKeyForTests()

    private var compactRows: [ProgressLeaderboardRow] {
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

    private var rankingRows: [ProgressLeaderboardRankingRow] {
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

    private var viewer: ProgressLeaderboardViewer {
        ProgressLeaderboardViewer(
            publicProfileId: "profile-viewer",
            displayName: "You",
            rank: 42,
            qualifiedReviewCount: 7
        )
    }

    private func makeReadyLeaderboardState(
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
            scopeKey: self.scopeKey,
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
            scopeKey: self.scopeKey,
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
            scopeKey: self.scopeKey,
            personalStreakDays: 12
        )
        let unavailableServerSnapshot = try makeProgressStreakLeaderboardSnapshot(
            leaderboard: makeNonReadyProgressStreakLeaderboardForTests(status: .snapshotUnavailable),
            scopeKey: self.scopeKey,
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
        let readyState = self.makeReadyLeaderboardState(
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
        let readyState = self.makeReadyLeaderboardState(
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
            scopeKey: self.scopeKey,
            state: .awaitingServerData
        )
        XCTAssertEqual(
            makeEmptyReviewLeaderboardBadgeState(),
            makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: unknownSnapshot)
        )

        let readySnapshot = ProgressLeaderboardSnapshot(
            scopeKey: self.scopeKey,
            state: .ready(
                self.makeReadyLeaderboardState(
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

    func testFactoryMapsReadyCompactRows() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last7Days,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: self.rankingRows
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: self.scopeKey,
            canonicalQualifiedReviewEvents: [],
            pendingQualifiedReviewEvents: [],
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        XCTAssertEqual(.last24Hours, readyState.defaultWindowKey)
        XCTAssertEqual(LeaderboardWindowKey.stableOrder, readyState.windows.map(\.windowKey))

        let window = try XCTUnwrap(readyState.windows.first)
        XCTAssertEqual(128, window.participantCount)
        XCTAssertEqual(42, window.viewerRank)
        XCTAssertEqual(7, window.viewerQualifiedReviewCount)
        XCTAssertEqual(9, window.rows.count)

        guard case .participant(let firstRow) = window.rows[0] else {
            XCTFail("Expected a participant row first, received \(window.rows[0])")
            return
        }

        XCTAssertEqual(.top, firstRow.kind)
        XCTAssertEqual(1, firstRow.rank)
        XCTAssertEqual(51, firstRow.qualifiedReviewCount)
        XCTAssertEqual("Silver Bright Harbor", firstRow.anonymousDisplayName)

        guard case .participant(let viewerRow) = window.rows[5] else {
            XCTFail("Expected the viewer row at index 5, received \(window.rows[5])")
            return
        }

        XCTAssertEqual(.viewer, viewerRow.kind)
        XCTAssertEqual(42, viewerRow.rank)
        XCTAssertEqual("profile-viewer", viewerRow.publicProfileId)
    }

    func testFactoryKeepsTopThreeRowsBeforeEllipsis() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: self.rankingRows
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: self.scopeKey,
            canonicalQualifiedReviewEvents: [],
            pendingQualifiedReviewEvents: [],
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        let window = try XCTUnwrap(readyState.windows.first)
        for index in 0 ..< 3 {
            guard case .participant(let row) = window.rows[index] else {
                XCTFail("Expected a top participant row at index \(index), received \(window.rows[index])")
                return
            }

            XCTAssertEqual(.top, row.kind)
            XCTAssertEqual(index + 1, row.rank)
        }

        guard case .gap(let firstGapRow) = window.rows[3] else {
            XCTFail("Expected a gap row at index 3, received \(window.rows[3])")
            return
        }
        guard case .gap(let secondGapRow) = window.rows[7] else {
            XCTFail("Expected a gap row at index 7, received \(window.rows[7])")
            return
        }
        guard case .participant(let lastRow) = window.rows[8] else {
            XCTFail("Expected the last-place participant row at index 8, received \(window.rows[8])")
            return
        }

        XCTAssertEqual("gap-3", firstGapRow.id)
        XCTAssertEqual("gap-7", secondGapRow.id)
        XCTAssertNotEqual(firstGapRow.id, secondGapRow.id)
        XCTAssertEqual(128, lastRow.rank)
        XCTAssertEqual(0, lastRow.qualifiedReviewCount)
    }

    func testFactoryIncludesFriendRowsFromRankingRows() throws {
        let friendRankingRows = self.rankingRows.map { rankingRow in
            switch rankingRow.rank {
            case 2:
                return ProgressLeaderboardRankingRow(
                    kind: rankingRow.kind,
                    publicProfileId: rankingRow.publicProfileId,
                    anonymousDisplayName: rankingRow.anonymousDisplayName,
                    friendDisplayName: "Ari",
                    qualifiedReviewCount: rankingRow.qualifiedReviewCount,
                    rank: rankingRow.rank
                )
            case 20:
                return ProgressLeaderboardRankingRow(
                    kind: rankingRow.kind,
                    publicProfileId: rankingRow.publicProfileId,
                    anonymousDisplayName: rankingRow.anonymousDisplayName,
                    friendDisplayName: "Mina 🎯",
                    qualifiedReviewCount: rankingRow.qualifiedReviewCount,
                    rank: rankingRow.rank
                )
            default:
                return rankingRow
            }
        }
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: friendRankingRows
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: self.scopeKey,
            canonicalQualifiedReviewEvents: [],
            pendingQualifiedReviewEvents: [],
            now: now
        )

        guard case .ready(let readyState) = snapshot.state else {
            XCTFail("Expected ready leaderboard state, received \(snapshot.state)")
            return
        }

        let window = try XCTUnwrap(readyState.windows.first)
        let participantRows = window.rows.compactMap { row -> ProgressLeaderboardParticipantRowState? in
            guard case .participant(let participantRow) = row else {
                return nil
            }

            return participantRow
        }
        let gapCount = window.rows.reduce(0) { count, row in
            if case .gap(_) = row {
                return count + 1
            }

            return count
        }

        XCTAssertEqual([1, 2, 3, 20, 41, 42, 43, 128], participantRows.map(\.rank))
        XCTAssertEqual(3, gapCount)

        let topFriendRow = try XCTUnwrap(participantRows.first { row in
            row.rank == 2
        })
        let insertedFriendRow = try XCTUnwrap(participantRows.first { row in
            row.rank == 20
        })

        XCTAssertEqual("Ari", topFriendRow.friendDisplayName)
        XCTAssertEqual("Mina 🎯", insertedFriendRow.friendDisplayName)
        XCTAssertEqual(.neighbor, insertedFriendRow.kind)
    }

    func testGuestAndParticipationDisabledStatusesMapToPlaceholders() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))
        let expectedStatesByStatus: [ProgressLeaderboardStatus: ProgressLeaderboardSnapshotState] = [
            .linkedAccountRequired: .signInRequired,
            .participationDisabled: .participationDisabled,
            .snapshotUnavailable: .snapshotUnavailable,
        ]

        for (status, expectedState) in expectedStatesByStatus {
            let snapshot = try makeProgressLeaderboardSnapshot(
                leaderboard: makeNonReadyProgressLeaderboardForTests(status: status),
                scopeKey: self.scopeKey,
                canonicalQualifiedReviewEvents: [],
                pendingQualifiedReviewEvents: [],
                now: now
            )

            XCTAssertEqual(expectedState, snapshot.state)
            XCTAssertEqual(self.scopeKey, snapshot.scopeKey)
        }
    }

    // The info copy must mention the same localized rating names the review
    // buttons use, in whichever language the test bundle runs.
    func testInfoCopyIncludesAgainExclusion() {
        let infoMessage = progressLeaderboardInfoMessage(
            snapshotGeneratedAt: nil,
            now: Date()
        )

        XCTAssertTrue(infoMessage.contains(ReviewRating.hard.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.good.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.easy.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.again.title))
    }

    func testLiveOverlayReranksOnlyViewerFromRankingRows() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: self.rankingRows
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
            scopeKey: self.scopeKey,
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
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: self.rankingRows
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
            scopeKey: self.scopeKey,
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
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: self.rankingRows
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
            scopeKey: self.scopeKey,
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

    func testFactoryRejectsRankingRowsWithoutViewerRow() throws {
        let rankingRowsWithoutViewer = self.rankingRows.map { rankingRow in
            if rankingRow.kind == .viewer {
                return makeProgressLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: rankingRow.publicProfileId,
                    anonymousDisplayName: rankingRow.anonymousDisplayName,
                    qualifiedReviewCount: rankingRow.qualifiedReviewCount,
                    rank: rankingRow.rank
                )
            }

            return rankingRow
        }
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: rankingRowsWithoutViewer
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        XCTAssertThrowsError(
            try makeProgressLeaderboardSnapshot(
                leaderboard: leaderboard,
                scopeKey: self.scopeKey,
                canonicalQualifiedReviewEvents: [],
                pendingQualifiedReviewEvents: [],
                now: now
            )
        ) { error in
            guard let validationError = error as? ProgressLeaderboardValidationError else {
                XCTFail("Expected ProgressLeaderboardValidationError, received \(error)")
                return
            }

            guard case .viewerRankingRowMismatch(windowKey: let windowKey) = validationError else {
                XCTFail("Expected viewerRankingRowMismatch, received \(error)")
                return
            }

            XCTAssertEqual(LeaderboardWindowKey.last24Hours.rawValue, windowKey)
        }
    }

    func testFactoryRejectsNonContiguousRankingRowRanks() throws {
        let rankingRowsWithSkippedRank = self.rankingRows.map { rankingRow in
            if rankingRow.rank == 3 {
                return makeProgressLeaderboardRankingRowForTests(
                    kind: rankingRow.kind,
                    publicProfileId: rankingRow.publicProfileId,
                    anonymousDisplayName: rankingRow.anonymousDisplayName,
                    qualifiedReviewCount: rankingRow.qualifiedReviewCount,
                    rank: 4
                )
            }

            return rankingRow
        }
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows,
            rankingRows: rankingRowsWithSkippedRank
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        XCTAssertThrowsError(
            try makeProgressLeaderboardSnapshot(
                leaderboard: leaderboard,
                scopeKey: self.scopeKey,
                canonicalQualifiedReviewEvents: [],
                pendingQualifiedReviewEvents: [],
                now: now
            )
        ) { error in
            guard let validationError = error as? ProgressLeaderboardValidationError else {
                XCTFail("Expected ProgressLeaderboardValidationError, received \(error)")
                return
            }

            guard case .invalidRankingRowRank(
                windowKey: let windowKey,
                expectedRank: let expectedRank,
                actualRank: let actualRank
            ) = validationError else {
                XCTFail("Expected invalidRankingRowRank, received \(error)")
                return
            }

            XCTAssertEqual(LeaderboardWindowKey.last24Hours.rawValue, windowKey)
            XCTAssertEqual(3, expectedRank)
            XCTAssertEqual(4, actualRank)
        }
    }

    func testDecoderRejectsNonReadyStreakLeaderboardWithReadyPayloadFields() throws {
        let json = """
        {
          "status": "snapshot_unavailable",
          "metric": {
            "metricVersion": "streak_days_v1",
            "title": "Current streak days",
            "description": "Ranks use current streak days from the public daily snapshot."
          },
          "snapshotId": "49c6a3f5-7dc7-48ef-9f81-8ec98c13f86c"
        }
        """

        XCTAssertThrowsError(
            try JSONDecoder().decode(
                UserProgressStreakLeaderboard.self,
                from: Data(json.utf8)
            )
        ) { error in
            guard case DecodingError.dataCorrupted(let context) = error else {
                XCTFail("Expected dataCorrupted decoding error, received \(error)")
                return
            }

            XCTAssertTrue(
                context.debugDescription.contains("Non-ready streak leaderboard payload must not include snapshotId.")
            )
        }
    }
}
