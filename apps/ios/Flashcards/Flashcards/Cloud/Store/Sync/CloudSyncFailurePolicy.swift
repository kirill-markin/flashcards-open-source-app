import Foundation

private let blockedCloudIdentityConflictCodes: Set<String> = [
    "GUEST_SESSION_PLATFORM_MISMATCH",
    "SYNC_INSTALLATION_PLATFORM_MISMATCH",
    "SYNC_REPLICA_CONFLICT",
    "SYNC_WORKSPACE_FORK_REQUIRED"
]

enum CloudSyncFailureStatusFallback {
    case cloudState(CloudAccountState?)
    case failed
}

enum CloudSyncFailureStatusDecision {
    case blockedForRecovery(reason: CloudCredentialRecoveryReason)
    case idle
    case blockedForIdentityConflict(message: String)
    case failed(message: String)
}

struct CloudFailureDiagnostics {
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
}

enum CloudSyncFailurePolicy {
    static func statusDecision(
        recoveryReason: CloudCredentialRecoveryReason?,
        postAuthenticationFailureIsIdle: Bool,
        identityConflictMessage: String?,
        failureMessage: String,
        fallback: CloudSyncFailureStatusFallback
    ) -> CloudSyncFailureStatusDecision {
        if let recoveryReason {
            return .blockedForRecovery(reason: recoveryReason)
        }
        if postAuthenticationFailureIsIdle {
            return .idle
        }
        if let identityConflictMessage {
            return .blockedForIdentityConflict(message: identityConflictMessage)
        }

        switch fallback {
        case .failed:
            return .failed(message: failureMessage)
        case .cloudState(let cloudState):
            if cloudState == .linked || cloudState == .guest {
                return .failed(message: failureMessage)
            }
            return .idle
        }
    }

    static func isBlockedIdentityConflict(error: Error) -> Bool {
        guard let syncError = error as? CloudSyncError else {
            return false
        }
        guard case .invalidResponse(let details, _) = syncError else {
            return false
        }
        return blockedCloudIdentityConflictCodes.contains(details.code ?? "")
    }

    static func diagnostics(error: Error) -> CloudFailureDiagnostics {
        if let syncError = error as? CloudSyncError {
            switch syncError {
            case .invalidResponse(let details, let statusCode):
                return CloudFailureDiagnostics(
                    statusCode: statusCode,
                    backendCode: details.code,
                    requestId: details.requestId
                )
            case .invalidBaseUrl:
                return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
            }
        }

        if let authError = error as? CloudAuthError {
            switch authError {
            case .invalidResponse(let details, let statusCode):
                return CloudFailureDiagnostics(
                    statusCode: statusCode,
                    backendCode: details.code,
                    requestId: details.requestId
                )
            case .invalidBaseUrl, .invalidResponseBody:
                return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
            }
        }

        if let guestAuthError = error as? GuestCloudAuthError {
            switch guestAuthError {
            case .invalidResponse(let details, let statusCode):
                return CloudFailureDiagnostics(
                    statusCode: statusCode,
                    backendCode: details.code,
                    requestId: details.requestId
                )
            case .invalidBaseUrl, .invalidResponseBody:
                return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
            }
        }

        return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
    }
}
