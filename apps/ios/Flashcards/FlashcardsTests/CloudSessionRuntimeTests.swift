import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class CloudSessionRuntimeTests: XCTestCase {
    func testSignInWithPasswordReturnsVerifiedAuthContext() async throws {
        let authService = MockCloudAuthService()
        authService.signInWithPasswordResult = StoredCloudCredentials(
            refreshToken: "refresh-token",
            idToken: "id-token",
            idTokenExpiresAt: "2030-01-01T00:00:00.000Z"
        )
        let runtime = CloudSessionRuntime(
            cloudAuthService: authService,
            cloudSyncService: nil,
            credentialStore: InMemoryCredentialStore()
        )

        let verifiedContext = try await runtime.signInWithPassword(
            email: "reviewer@example.com",
            password: "reviewer-password",
            configuration: CloudServiceConfiguration(
                mode: .official,
                customOrigin: nil,
                apiBaseUrl: "https://api.example.com/v1",
                authBaseUrl: "https://auth.example.com"
            )
        )

        XCTAssertEqual(authService.signInWithPasswordCalls.count, 1)
        XCTAssertEqual(authService.signInWithPasswordCalls[0].email, "reviewer@example.com")
        XCTAssertEqual(authService.signInWithPasswordCalls[0].password, "reviewer-password")
        XCTAssertEqual(verifiedContext.apiBaseUrl, "https://api.example.com/v1")
        XCTAssertEqual(verifiedContext.credentials.idToken, "id-token")
        XCTAssertEqual(verifiedContext.credentials.refreshToken, "refresh-token")
    }
}

@MainActor
private final class MockCloudAuthService: CloudAuthServing {
    struct PasswordCall: Hashable {
        let email: String
        let password: String
    }

    var signInWithPasswordCalls: [PasswordCall]
    var signInWithPasswordResult: StoredCloudCredentials?

    init() {
        self.signInWithPasswordCalls = []
        self.signInWithPasswordResult = nil
    }

    func sendCode(email: String, authBaseUrl: String) async throws -> CloudOtpChallenge {
        throw LocalStoreError.validation("Unexpected sendCode call in CloudSessionRuntimeTests")
    }

    func signInWithPassword(email: String, password: String, authBaseUrl: String) async throws -> StoredCloudCredentials {
        self.signInWithPasswordCalls.append(PasswordCall(email: email, password: password))

        guard let signInWithPasswordResult else {
            throw LocalStoreError.validation("Missing signInWithPasswordResult in CloudSessionRuntimeTests")
        }

        return signInWithPasswordResult
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
