import Foundation
import XCTest
@testable import Flashcards

final class CloudSupportTests: XCTestCase {
    func testMakeIdTokenExpiryTimestampProducesFutureIsoTimestamp() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T10:00:00.000Z"))

        let expiresAt = makeIdTokenExpiryTimestamp(now: now, expiresInSeconds: 120)
        let parsedDate = try XCTUnwrap(parseIsoTimestamp(value: expiresAt))

        XCTAssertEqual(expiresAt, "2026-03-08T10:02:00.000Z")
        XCTAssertEqual(parsedDate.timeIntervalSince(now), 120, accuracy: 0.001)
    }

    func testShouldRefreshCloudIdTokenReturnsFalseForFarFutureExpiry() {
        XCTAssertFalse(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "2026-03-08T10:10:00.000Z",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }

    func testShouldRefreshCloudIdTokenReturnsTrueForNearExpiry() {
        XCTAssertTrue(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "2026-03-08T10:04:59.000Z",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }

    func testShouldRefreshCloudIdTokenReturnsTrueForInvalidTimestamp() {
        XCTAssertTrue(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "not-a-timestamp",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }
}
