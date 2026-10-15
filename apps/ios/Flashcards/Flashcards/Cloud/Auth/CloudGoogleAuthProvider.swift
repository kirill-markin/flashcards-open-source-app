import Foundation
import GoogleSignIn

@MainActor
final class CloudGoogleAuthProvider {
    private static var isAuthorizing = false

    func authorize(
        login: CloudSocialLoginAttempt,
        methods: CloudAuthMethods,
        presentation: CloudNativeAuthPresentation
    ) async throws -> CloudSocialProviderProof {
        guard !Self.isAuthorizing else { throw CloudNativeAuthError.alreadyInProgress }
        let metadata = try validateNativeProviderAttempt(login: login, methods: methods, provider: .google)
        guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              metadata.presenters.contains(clientId),
              login.response.nonce.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            throw CloudNativeAuthError.invalidConfiguration(.google)
        }
        try presentation.validate()
        guard !Task.isCancelled else { throw CloudNativeAuthError.cancelled(.google) }
        Self.isAuthorizing = true
        let signIn = GIDSignIn.sharedInstance
        signIn.configuration = GIDConfiguration(clientID: clientId, serverClientID: metadata.audience)
        defer {
            // Nibomo owns the session; the provider SDK must not retain an independent one.
            signIn.signOut()
            Self.isAuthorizing = false
        }
        let token: String = try await withCheckedThrowingContinuation { continuation in
            signIn.signIn(withPresenting: presentation.viewController,
                hint: nil, additionalScopes: nil, nonce: login.response.nonce) { result, error in
                if let error {
                    let providerError = error as NSError
                    let failure: CloudNativeAuthError = providerError.domain == kGIDSignInErrorDomain
                        && providerError.code == GIDSignInError.canceled.rawValue
                        ? .cancelled(.google) : .providerFailure(.google, providerError)
                    continuation.resume(throwing: failure)
                } else if let token = result?.user.idToken?.tokenString, !token.isEmpty {
                    continuation.resume(returning: token)
                } else {
                    continuation.resume(throwing: CloudNativeAuthError.invalidCredential(.google))
                }
            }
        }
        guard !Task.isCancelled else { throw CloudNativeAuthError.cancelled(.google) }
        // Detect the released SDK’s Device Policy restart nonce loss. The server still verifies the JWT.
        try requireGoogleNonce(token: token, nonce: login.response.nonce)
        return .google(identityToken: token)
    }
}

private struct GoogleNonceClaim: Decodable {
    let nonce: String
}

private func requireGoogleNonce(token: String, nonce: String) throws {
    let segments = token.split(separator: ".", omittingEmptySubsequences: false)
    guard segments.count == 3 else { throw CloudNativeAuthError.invalidCredential(.google) }
    var payload = String(segments[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
    guard let data = Data(base64Encoded: payload) else { throw CloudNativeAuthError.invalidCredential(.google) }
    let claim: GoogleNonceClaim
    do {
        claim = try JSONDecoder().decode(GoogleNonceClaim.self, from: data)
    } catch {
        throw CloudNativeAuthError.freshAttemptRequired(.google)
    }
    guard claim.nonce == nonce else { throw CloudNativeAuthError.freshAttemptRequired(.google) }
}
