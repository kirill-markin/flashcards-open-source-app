import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class CloudAppleAuthProvider: NSObject, ASAuthorizationControllerDelegate {
    private var continuation: CheckedContinuation<CloudSocialProviderProof, Error>?
    private var controller: ASAuthorizationController?
    private var presentationContext: CloudAppleAuthPresentationContext?
    private var expectedState: String?

    func authorize(
        login: CloudSocialLoginAttempt,
        methods: CloudAuthMethods,
        presentation: CloudNativeAuthPresentation
    ) async throws -> CloudSocialProviderProof {
        guard self.controller == nil else { throw CloudNativeAuthError.alreadyInProgress }
        let metadata = try validateNativeProviderAttempt(login: login, methods: methods, provider: .apple)
        guard let bundleId = Bundle.main.bundleIdentifier,
              metadata.audience == bundleId, metadata.presenters.contains(bundleId),
              login.response.nonce.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw CloudNativeAuthError.invalidConfiguration(.apple)
        }
        try presentation.validate()
        guard !Task.isCancelled else { throw CloudNativeAuthError.cancelled(.apple) }
        let attemptId = login.response.attempt
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email]
        // The server already supplies Apple’s lowercase SHA-256 nonce.
        request.nonce = login.response.nonce
        request.state = login.response.attempt
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        let context = CloudAppleAuthPresentationContext(window: presentation.window)
        controller.presentationContextProvider = context
        self.controller = controller
        self.presentationContext = context
        self.expectedState = login.response.attempt
        defer {
            self.controller = nil
            self.presentationContext = nil
            self.expectedState = nil
        }
        let proof: CloudSocialProviderProof = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                if Task.isCancelled {
                    self.finish(.failure(CloudNativeAuthError.cancelled(.apple)))
                } else {
                    controller.performRequests()
                }
            }
        } onCancel: {
            Task { @MainActor in
                guard self.expectedState == attemptId else { return }
                self.controller?.cancel()
                self.finish(.failure(CloudNativeAuthError.cancelled(.apple)))
            }
        }
        guard !Task.isCancelled else { throw CloudNativeAuthError.cancelled(.apple) }
        return proof
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard controller === self.controller else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == self.expectedState,
              let tokenData = credential.identityToken, let codeData = credential.authorizationCode,
              let token = String(data: tokenData, encoding: .utf8), !token.isEmpty,
              let code = String(data: codeData, encoding: .utf8), !code.isEmpty else {
            self.finish(.failure(CloudNativeAuthError.invalidCredential(.apple)))
            return
        }
        self.finish(.success(.apple(identityToken: token, authorizationCode: code)))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard controller === self.controller else { return }
        let providerError = error as NSError
        let result: CloudNativeAuthError = providerError.domain == ASAuthorizationError.errorDomain
            && providerError.code == ASAuthorizationError.canceled.rawValue
            ? .cancelled(.apple) : .providerFailure(.apple, providerError)
        self.finish(.failure(result))
    }

    private func finish(_ result: Result<CloudSocialProviderProof, Error>) {
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(with: result)
    }
}

@MainActor
private final class CloudAppleAuthPresentationContext: NSObject, ASAuthorizationControllerPresentationContextProviding {
    private let window: UIWindow

    init(window: UIWindow) {
        self.window = window
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        self.window
    }
}
