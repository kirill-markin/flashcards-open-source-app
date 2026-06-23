import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotFactoryRenderingTests: XCTestCase {
    func testFactoryMapsReadyCompactRows() throws {
        let leaderboard = makeReadyProgressLeaderboardForTests(
            defaultWindowKey: .last7Days,
            participantCount: 128,
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: makeProgressSnapshotFactoryRankingRows()
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
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
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: makeProgressSnapshotFactoryRankingRows()
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
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
        let friendRankingRows = makeProgressSnapshotFactoryRankingRows().map { rankingRow in
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
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: friendRankingRows
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        let snapshot = try makeProgressLeaderboardSnapshot(
            leaderboard: leaderboard,
            scopeKey: progressSnapshotFactoryScopeKey,
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
                scopeKey: progressSnapshotFactoryScopeKey,
                canonicalQualifiedReviewEvents: [],
                pendingQualifiedReviewEvents: [],
                now: now
            )

            XCTAssertEqual(expectedState, snapshot.state)
            XCTAssertEqual(progressSnapshotFactoryScopeKey, snapshot.scopeKey)
        }
    }

    func testLeaderboardUpdatedTextFormatsElapsedFreshness() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        XCTAssertEqual(
            expectedProgressSnapshotFactoryLeaderboardUpdatedText(
                elapsedText: expectedProgressSnapshotFactoryLeaderboardElapsedMinuteText(minutes: 59)
            ),
            progressLeaderboardUpdatedText(snapshotGeneratedAt: "2026-06-10T14:00:30.000Z", now: now)
        )
        XCTAssertEqual(
            expectedProgressSnapshotFactoryLeaderboardUpdatedText(
                elapsedText: expectedProgressSnapshotFactoryLeaderboardElapsedHourText(hours: 1)
            ),
            progressLeaderboardUpdatedText(snapshotGeneratedAt: "2026-06-10T14:00:00.000Z", now: now)
        )
        XCTAssertEqual(
            expectedProgressSnapshotFactoryLeaderboardUpdatedText(
                elapsedText: expectedProgressSnapshotFactoryLeaderboardElapsedHoursMinutesText(hours: 1, minutes: 5)
            ),
            progressLeaderboardUpdatedText(snapshotGeneratedAt: "2026-06-10T13:55:00.000Z", now: now)
        )
        XCTAssertEqual(
            expectedProgressSnapshotFactoryLeaderboardUpdatedText(
                elapsedText: expectedProgressSnapshotFactoryLeaderboardElapsedMinuteText(minutes: 0)
            ),
            progressLeaderboardUpdatedText(snapshotGeneratedAt: "2026-06-10T15:01:00.000Z", now: now)
        )
        XCTAssertNil(
            progressLeaderboardUpdatedText(snapshotGeneratedAt: "not-a-timestamp", now: now)
        )
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

    func testStreakInfoCopyIncludesAllReviewedRatingNames() {
        let infoMessage = progressStreakLeaderboardInfoMessage(
            snapshotGeneratedAt: nil,
            now: Date()
        )

        XCTAssertTrue(infoMessage.contains(ReviewRating.again.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.hard.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.good.title))
        XCTAssertTrue(infoMessage.contains(ReviewRating.easy.title))
    }
}
