import Foundation
import XCTest
@testable import Flashcards

final class CloudConfigurationAndAccountTests: XCTestCase, @unchecked Sendable {
    override func tearDown() {
        CloudSupportTestSupport.clearRequestHandler()
        super.tearDown()
    }

    func testLoadCloudServiceConfigurationReadsUrlsFromBundleInfoDictionary() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.example.com/v1/",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com/"
            ]
        )
        let userDefaults = try CloudSupportTestSupport.makeUserDefaults(testCase: self)

        let configuration = try loadCloudServiceConfiguration(
            bundle: bundle,
            userDefaults: userDefaults,
            decoder: JSONDecoder()
        )

        XCTAssertEqual(configuration.mode, .official)
        XCTAssertNil(configuration.customOrigin)
        XCTAssertEqual(configuration.apiBaseUrl, "https://api.example.com/v1")
        XCTAssertEqual(configuration.authBaseUrl, "https://auth.example.com")
    }

    func testLoadFlashcardsLegalSupportConfigurationReadsValuesFromBundleInfoDictionary() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "https://flashcards.example.com/privacy/",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "https://flashcards.example.com/support/",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        let configuration = try loadFlashcardsLegalSupportConfiguration(bundle: bundle)

        XCTAssertEqual(
            configuration,
            FlashcardsLegalSupportConfiguration(
                privacyPolicyUrl: "https://flashcards.example.com/privacy/",
                termsOfServiceUrl: "https://flashcards.example.com/terms/",
                supportUrl: "https://flashcards.example.com/support/",
                supportEmailAddress: "support@example.com"
            )
        )
    }

    func testLoadCloudServiceConfigurationUsesStoredCustomServerOverrideWhenPresent() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.flashcards-open-source-app.com/v1",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.flashcards-open-source-app.com"
            ]
        )
        let userDefaults = try CloudSupportTestSupport.makeUserDefaults(testCase: self)
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://self-hosted.example.com"),
            userDefaults: userDefaults,
            encoder: JSONEncoder()
        )

        let configuration = try loadCloudServiceConfiguration(
            bundle: bundle,
            userDefaults: userDefaults,
            decoder: JSONDecoder()
        )

        XCTAssertEqual(configuration.mode, .custom)
        XCTAssertEqual(configuration.customOrigin, "https://self-hosted.example.com")
        XCTAssertEqual(configuration.apiBaseUrl, "https://api.self-hosted.example.com/v1")
        XCTAssertEqual(configuration.authBaseUrl, "https://auth.self-hosted.example.com")
    }

    func testGuestCloudCredentialStoreMigratesLegacyStoredSessionUsingCurrentConfiguration() throws {
        struct LegacySession: Codable {
            let guestToken: String
            let userId: String
            let workspaceId: String
        }

        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.example.com/v1/",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com/"
            ]
        )
        let userDefaults = try CloudSupportTestSupport.makeUserDefaults(testCase: self)
        let service = "tests-\(UUID().uuidString)"
        let account = "primary"
        let fileUrl = FileManager.default.temporaryDirectory.appendingPathComponent(
            "\(service)-\(account)-guest-cloud-session.json".replacingOccurrences(of: "/", with: "-"),
            isDirectory: false
        )
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: fileUrl)
        }

        let legacySession = LegacySession(
            guestToken: "guest-token-1",
            userId: "guest-user-1",
            workspaceId: "guest-workspace-1"
        )
        let legacyData = try JSONEncoder().encode(legacySession)
        try legacyData.write(to: fileUrl, options: .atomic)

        let store = GuestCloudCredentialStore(
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            service: service,
            account: account,
            bundle: bundle,
            userDefaults: userDefaults
        )

        let migratedSession = try XCTUnwrap(store.loadGuestSession())

        XCTAssertEqual(
            migratedSession,
            StoredGuestCloudSession(
                guestToken: legacySession.guestToken,
                userId: legacySession.userId,
                workspaceId: legacySession.workspaceId,
                configurationMode: .official,
                apiBaseUrl: "https://api.example.com/v1"
            )
        )
        XCTAssertEqual(try XCTUnwrap(store.loadGuestSession()), migratedSession)
    }

    func testLoadCloudServiceConfigurationThrowsMissingValueWhenApiBaseUrlIsAbsent() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )
        let userDefaults = try CloudSupportTestSupport.makeUserDefaults(testCase: self)

        XCTAssertThrowsError(
            try loadCloudServiceConfiguration(bundle: bundle, userDefaults: userDefaults, decoder: JSONDecoder())
        ) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .missingValue("FLASHCARDS_API_BASE_URL")
            )
        }
    }

    func testLoadCloudServiceConfigurationThrowsInvalidUrlWhenApiBaseUrlIsMalformed() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "not a url",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )
        let userDefaults = try CloudSupportTestSupport.makeUserDefaults(testCase: self)

        XCTAssertThrowsError(
            try loadCloudServiceConfiguration(bundle: bundle, userDefaults: userDefaults, decoder: JSONDecoder())
        ) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidUrl("FLASHCARDS_API_BASE_URL", "not a url")
            )
        }
    }

    func testLoadFlashcardsLegalSupportConfigurationThrowsMissingValueWhenPrivacyUrlIsEmpty() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "   ",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "https://flashcards.example.com/support/",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        XCTAssertThrowsError(try loadFlashcardsLegalSupportConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .missingValue("FLASHCARDS_PRIVACY_POLICY_URL")
            )
        }
    }

    func testLoadFlashcardsLegalSupportConfigurationThrowsInvalidUrlWhenSupportUrlIsMalformed() throws {
        let bundle = try CloudSupportTestSupport.makeBundle(
            testCase: self,
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "https://flashcards.example.com/privacy/",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "not a url",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        XCTAssertThrowsError(try loadFlashcardsLegalSupportConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidUrl("FLASHCARDS_SUPPORT_URL", "not a url")
            )
        }
    }

    func testMakeCustomCloudServiceConfigurationRejectsInvalidOrigin() {
        XCTAssertThrowsError(try makeCustomCloudServiceConfiguration(customOrigin: "http://example.com/path")) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidCustomOrigin("http://example.com/path")
            )
        }
    }

    @MainActor
    func testCloudServiceConfigurationValidatorChecksExpectedHealthEndpoints() async throws {
        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.absoluteString)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data())
        }

        let validator = CloudServiceConfigurationValidator(session: CloudSupportTestSupport.makeSession())

        try await validator.validate(
            configuration: CloudServiceConfiguration(
                mode: .custom,
                customOrigin: "https://example.com",
                apiBaseUrl: "https://api.example.com/v1",
                authBaseUrl: "https://auth.example.com"
            )
        )

        XCTAssertEqual(
            Set(recorder.requestPaths),
            [
                "https://api.example.com/v1/health",
                "https://auth.example.com/health"
            ]
        )
    }

    @MainActor
    func testCloudServiceConfigurationValidatorFailsWhenHealthCheckReturnsNonSuccessStatus() async throws {
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: url.absoluteString.contains("auth.") ? 503 : 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data())
        }

        let validator = CloudServiceConfigurationValidator(session: CloudSupportTestSupport.makeSession())

        do {
            try await validator.validate(
                configuration: CloudServiceConfiguration(
                    mode: .custom,
                    customOrigin: "https://example.com",
                    apiBaseUrl: "https://api.example.com/v1",
                    authBaseUrl: "https://auth.example.com"
                )
            )
            XCTFail("Expected health-check validation to fail")
        } catch {
            XCTAssertEqual(
                Flashcards.errorMessage(error: error),
                "Auth service health check returned status 503 for https://auth.example.com/health"
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
                idTokenExpiresAt: "2026-03-08T00:38:19.000Z",
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
