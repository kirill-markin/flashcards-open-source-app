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
                qualifiedReviewCount: 7,
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

    func testFactoryMapsReadyCompactRows() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last7Days,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows
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

        XCTAssertEqual(.last7Days, readyState.defaultWindowKey)
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
            rows: self.compactRows
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

    func testLiveOverlayChangesOnlyViewerCount() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows
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
            XCTAssertEqual(42, window.viewerRank)
            XCTAssertEqual(128, window.participantCount)

            for row in window.rows {
                guard case .participant(let participantRow) = row else {
                    continue
                }

                if participantRow.kind == .viewer {
                    XCTAssertEqual(9, participantRow.qualifiedReviewCount)
                    XCTAssertEqual(42, participantRow.rank)
                } else if participantRow.rank == 1 {
                    XCTAssertEqual(51, participantRow.qualifiedReviewCount)
                } else if participantRow.rank == 41 {
                    XCTAssertEqual(8, participantRow.qualifiedReviewCount)
                } else if participantRow.rank == 43 {
                    XCTAssertEqual(7, participantRow.qualifiedReviewCount)
                }
            }
        }
    }

    func testLiveOverlayNeverLowersServerViewerCount() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last24Hours,
            participantCount: 128,
            viewer: self.viewer,
            rows: self.compactRows
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
        }
    }
}
