import Foundation

extension CloudSignInMethod {
    var analyticsMethod: AnalyticsAuthMethod {
        switch self {
        case .apple: return .apple
        case .google: return .google
        case .email: return .email
        }
    }
}

func recordNativeSignInStage(_ stage: CloudNativeSignInStage, screen: AnalyticsSurface) {
    switch stage {
    case .credentialReceived(let provider):
        Analytics.track(.authProviderFinished(method: provider == .apple ? .apple : .google,
            outcome: .credentialReceived, screen: screen))
    default: break
    }
}

func nativeCodeVerificationOutcome(_ error: Error) -> AnalyticsAuthCodeVerificationOutcome {
    if let error = error as? URLError, error.code == .timedOut { return .timeout }
    switch analyticsSignInFailureReason(error: error) {
    case .invalidCode: return .invalidCode
    case .expiredCode: return .expiredCode
    case .codeAlreadyUsed: return .codeAlreadyUsed
    case .rateLimited: return .rateLimited
    case .offline: return .offline
    case .serverError, .cancelled:
        return .serverError
    }
}

func recordNativeProviderError(_ error: Error, stage: CloudNativeSignInStage, screen: AnalyticsSurface) {
    guard case .requestingProviderCredential(let provider) = stage,
          let nativeError = error as? CloudNativeAuthError else { return }
    let outcome: AnalyticsAuthProviderOutcome
    switch nativeError {
    case .cancelled: outcome = .cancelled
    case .unavailable: outcome = .unavailable
    case .invalidCredential, .invalidAttempt, .freshAttemptRequired: outcome = .invalidResponse
    case .providerFailure: outcome = .providerError
    case .invalidConfiguration, .presentationUnavailable, .alreadyInProgress: return
    }
    Analytics.track(.authProviderFinished(method: provider == .apple ? .apple : .google, outcome: outcome, screen: screen))
}

func nativeCodeRequestOutcome(_ error: Error) -> AnalyticsAuthCodeRequestOutcome {
    if let error = error as? URLError {
        if error.code == .timedOut { return .timeout }
        if error.code == .notConnectedToInternet || error.code == .networkConnectionLost { return .offline }
    }
    if case CloudAuthError.invalidResponse(_, let status) = error, status == 429 { return .rateLimited }
    return .serverError
}

func recordNativeAccountLinkError(_ error: Error, method: AnalyticsAuthMethod, screen: AnalyticsSurface) {
    guard case CloudAuthError.invalidResponse(let details, _) = error,
          details.code == "PROVIDER_ENROLLMENT_CONFLICT" else { return }
    Analytics.track(.authAccountLinkFinished(method: method, outcome: .conflict, screen: screen))
}

func nativeGuestUpgradeOutcome(_ error: Error) -> AnalyticsAuthGuestUpgradeOutcome {
    if let error = error as? URLError {
        if error.code == .timedOut { return .timeout }
        if error.code == .notConnectedToInternet || error.code == .networkConnectionLost { return .offline }
    }
    if let error = error as? CloudSyncError, error.statusCode == 409 { return .conflict }
    if case GuestCloudAuthError.invalidResponse(_, 409) = error { return .conflict }
    if error is CloudCredentialStoreError || error is GuestCloudCredentialStoreError { return .storageError }
    if let error = error as? LocalStoreError, case .database = error { return .storageError }
    return .serverError
}
