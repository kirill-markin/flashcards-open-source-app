import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotFactoryValidationTests: XCTestCase {
    func testFactoryRejectsRankingRowsWithoutViewerRow() throws {
        let rankingRowsWithoutViewer = makeProgressSnapshotFactoryRankingRows().map { rankingRow in
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
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: rankingRowsWithoutViewer
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        XCTAssertThrowsError(
            try makeProgressLeaderboardSnapshot(
                leaderboard: leaderboard,
                scopeKey: progressSnapshotFactoryScopeKey,
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
        let rankingRowsWithSkippedRank = makeProgressSnapshotFactoryRankingRows().map { rankingRow in
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
            viewer: makeProgressSnapshotFactoryViewer(),
            rows: makeProgressSnapshotFactoryCompactRows(),
            rankingRows: rankingRowsWithSkippedRank
        )
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T15:00:00.000Z"))

        XCTAssertThrowsError(
            try makeProgressLeaderboardSnapshot(
                leaderboard: leaderboard,
                scopeKey: progressSnapshotFactoryScopeKey,
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
