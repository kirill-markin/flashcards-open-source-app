import Foundation
import XCTest
@testable import Flashcards

final class CloudSupportTests: XCTestCase {
    func testLoadCloudServiceConfigurationReadsUrlsFromBundleInfoDictionary() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.example.com/v1/",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com/"
            ]
        )

        let configuration = try loadCloudServiceConfiguration(bundle: bundle)

        XCTAssertEqual(configuration.apiBaseUrl, "https://api.example.com/v1")
        XCTAssertEqual(configuration.authBaseUrl, "https://auth.example.com")
    }

    func testLoadCloudServiceConfigurationThrowsMissingValueWhenApiBaseUrlIsAbsent() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )

        XCTAssertThrowsError(try loadCloudServiceConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .missingValue("FLASHCARDS_API_BASE_URL")
            )
        }
    }

    func testLoadCloudServiceConfigurationThrowsInvalidUrlWhenApiBaseUrlIsMalformed() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "not a url",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )

        XCTAssertThrowsError(try loadCloudServiceConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidUrl("FLASHCARDS_API_BASE_URL", "not a url")
            )
        }
    }

    func testIsValidCloudEmailReturnsTrueForExpectedEmail() {
        XCTAssertTrue(isValidCloudEmail("user@example.com"))
    }

    func testIsValidCloudEmailReturnsFalseForEmptyValue() {
        XCTAssertFalse(isValidCloudEmail(""))
    }

    func testIsValidCloudEmailReturnsFalseForMissingDomain() {
        XCTAssertFalse(isValidCloudEmail("user@"))
    }

    func testIsValidCloudEmailReturnsFalseForMissingTopLevelDomain() {
        XCTAssertFalse(isValidCloudEmail("user@example"))
    }

    func testIsValidCloudEmailReturnsFalseForWhitespaceInsideAddress() {
        XCTAssertFalse(isValidCloudEmail("user example.com"))
    }

    func testIsValidCloudEmailNormalizesCaseAndOuterWhitespace() {
        XCTAssertEqual(normalizedCloudEmail(" User@Example.com "), "user@example.com")
        XCTAssertTrue(isValidCloudEmail(" User@Example.com "))
    }

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

    private func makeBundle(infoDictionary: [String: String]) throws -> Bundle {
        let rootUrl = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bundleUrl = rootUrl.appendingPathExtension("bundle")

        try FileManager.default.createDirectory(at: bundleUrl, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: rootUrl)
        }

        let infoPlistUrl = bundleUrl.appendingPathComponent("Info.plist")
        let infoPlistData = try PropertyListSerialization.data(
            fromPropertyList: infoDictionary,
            format: .xml,
            options: 0
        )
        try infoPlistData.write(to: infoPlistUrl)

        return try XCTUnwrap(Bundle(url: bundleUrl))
    }
}
