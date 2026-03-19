import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class CloudSessionRuntimeTests: XCTestCase {
    func testSendCodeReturnsVerifiedCredentialsWhenDemoBypassSucceeds() async throws {
        let authService = MockCloudAuthService()
        authService.sendCodeResult = .verifiedCredentials(
            StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2030-01-01T00:00:00.000Z"
            )
        )
        let runtime = CloudSessionRuntime(
            cloudAuthService: authService,
            cloudSyncService: nil,
            credentialStore: InMemoryCredentialStore()
        )

        let result = try await runtime.sendCode(
            email: "reviewer@example.com",
            configuration: CloudServiceConfiguration(
                mode: .official,
                customOrigin: nil,
                apiBaseUrl: "https://api.example.com/v1",
                authBaseUrl: "https://auth.example.com"
            )
        )

        switch result {
        case .otpChallenge:
            XCTFail("Expected verified credentials for the demo bypass path")
        case .verifiedCredentials(let credentials):
            XCTAssertEqual(credentials.idToken, "id-token")
            XCTAssertEqual(credentials.refreshToken, "refresh-token")
        }
    }
}

@MainActor
private final class MockCloudAuthService: CloudAuthServing {
    var sendCodeResult: CloudSendCodeResult?

    init() {
        self.sendCodeResult = nil
    }

    func sendCode(email: String, authBaseUrl: String) async throws -> CloudSendCodeResult {
        guard let sendCodeResult else {
            throw LocalStoreError.validation("Missing sendCodeResult in CloudSessionRuntimeTests")
        }

        return sendCodeResult
    }

    func verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ) async throws -> StoredCloudCredentials {
        throw LocalStoreError.validation("Unexpected verifyCode call in CloudSessionRuntimeTests")
    }

    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken {
        throw LocalStoreError.validation("Unexpected refreshIdToken call in CloudSessionRuntimeTests")
    }

    func resetChallengeSession() {}
}

private struct InMemoryCredentialStore: CredentialStoring {
    func loadCredentials() throws -> StoredCloudCredentials? {
        nil
    }

    func saveCredentials(credentials: StoredCloudCredentials) throws {}

    func clearCredentials() throws {}
}
