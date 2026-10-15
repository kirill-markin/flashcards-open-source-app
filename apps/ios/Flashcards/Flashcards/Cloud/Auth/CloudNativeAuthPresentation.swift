import Foundation
import UIKit

enum CloudNativeAuthError: Error {
    case cancelled(CloudAuthProvider)
    case unavailable(CloudAuthProvider)
    case presentationUnavailable
    case alreadyInProgress
    case invalidConfiguration(CloudAuthProvider)
    case invalidAttempt(CloudAuthProvider)
    case invalidCredential(CloudAuthProvider)
    case freshAttemptRequired(CloudAuthProvider)
    case providerFailure(CloudAuthProvider, NSError)
}

extension CloudAuthClient {
    static var currentNative: CloudAuthClient {
        #if targetEnvironment(macCatalyst)
        #if DEBUG
        return .macosDevelopment
        #else
        return .macos
        #endif
        #else
        #if DEBUG
        return .iosDevelopment
        #else
        return .ios
        #endif
        #endif
    }
}

@MainActor
struct CloudNativeAuthPresentation {
    let viewController: UIViewController
    let window: UIWindow

    init(viewController: UIViewController) throws {
        guard let window = viewController.viewIfLoaded?.window,
              window.windowScene?.activationState == .foregroundActive,
              !window.isHidden else {
            throw CloudNativeAuthError.presentationUnavailable
        }
        self.viewController = viewController
        self.window = window
    }

    func validate() throws {
        guard self.viewController.viewIfLoaded?.window === self.window,
              self.window.windowScene?.activationState == .foregroundActive,
              !self.window.isHidden else {
            throw CloudNativeAuthError.presentationUnavailable
        }
    }
}

func validateNativeProviderAttempt(
    login: CloudSocialLoginAttempt,
    methods: CloudAuthMethods,
    provider: CloudAuthProvider
) throws -> (audience: String, presenters: [String]) {
    try methods.validate(client: .currentNative)
    guard login.provider == provider, login.binding.client == methods.client,
          let expiry = parseIsoTimestamp(value: login.response.expiresAt), expiry > Date() else {
        throw CloudNativeAuthError.invalidAttempt(provider)
    }
    let availability = provider == .apple ? methods.methods.apple : methods.methods.google
    guard case .native(let audience, let presenters, _) = availability else {
        throw CloudNativeAuthError.unavailable(provider)
    }
    return (audience, presenters)
}
