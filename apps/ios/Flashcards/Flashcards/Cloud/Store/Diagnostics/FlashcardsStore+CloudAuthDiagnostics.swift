import Foundation

enum CloudAuthFailureAction: String {
    case sendCode = "auth_send_code"
    case verifyCode = "auth_verify_code"

    var phase: CloudFlowPhase {
        switch self {
        case .sendCode:
            return .authSendCode
        case .verifyCode:
            return .authVerifyCode
        }
    }
}

@MainActor
extension FlashcardsStore {
    func captureCloudAuthFailure(
        error: Error,
        configuration: CloudServiceConfiguration,
        action: CloudAuthFailureAction
    ) {
        self.captureCloudAuthFailure(
            error: error,
            configuration: configuration,
            action: action,
            captureContext: nil
        )
    }

    func captureCloudAuthFailure(
        error: Error,
        configuration: CloudServiceConfiguration,
        action: CloudAuthFailureAction,
        captureContext: TechnicalErrorCaptureContext?
    ) {
        let diagnostics = cloudAuthFailureDiagnostics(error: error)
        let scope = IOSObservationScope(
            feature: .cloudAuth,
            userId: nil,
            workspaceId: nil,
            requestId: diagnostics.requestId,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: self.cloudSettings?.cloudState,
            configurationMode: configuration.mode
        )
        if isUserCorrectableCloudAuthFailure(diagnostics: diagnostics) {
            FlashcardsObservability.addBreadcrumb(
                .cloudFlow(
                    CloudFlowObservation(
                        phase: action.phase,
                        outcome: .failure,
                        scope: scope,
                        requestId: diagnostics.requestId,
                        backendCode: diagnostics.backendCode,
                        statusCode: diagnostics.statusCode,
                        workspaceId: nil,
                        installationId: nil,
                        selection: nil,
                        sourceWorkspaceId: nil,
                        targetWorkspaceId: nil,
                        migrationKind: nil,
                        remoteWorkspaceIsEmpty: nil,
                        operationsCount: nil,
                        reviewScheduleImpactingOperationCount: nil,
                        changesCount: nil,
                        errorSummary: Flashcards.errorMessage(error: error)
                    )
                )
            )
            return
        }

        self.markTechnicalErrorCaptured(captureContext: captureContext)
        FlashcardsObservability.captureException(
            .cloudAuthFailed(
                error: error,
                scope: scope,
                details: CloudAuthFailureDetails(
                    action: action.rawValue,
                    statusCode: diagnostics.statusCode,
                    backendCode: diagnostics.backendCode,
                    requestId: diagnostics.requestId,
                    messageSummary: Flashcards.errorMessage(error: error)
                )
            )
        )
    }
}

private let userCorrectableCloudAuthBackendCodes: Set<String> = [
    "INVALID_EMAIL",
    "OTP_CHALLENGE_CONSUMED",
    "OTP_CODE_INVALID",
    "OTP_SESSION_EXPIRED",
    "OTP_TOO_MANY_ATTEMPTS"
]

private struct CloudAuthFailureDiagnosticsFields {
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
}

private func isUserCorrectableCloudAuthFailure(diagnostics: CloudAuthFailureDiagnosticsFields) -> Bool {
    guard let backendCode = diagnostics.backendCode else {
        return false
    }

    return userCorrectableCloudAuthBackendCodes.contains(backendCode)
}

private func cloudAuthFailureDiagnostics(error: Error) -> CloudAuthFailureDiagnosticsFields {
    if let authError = error as? CloudAuthError {
        switch authError {
        case .invalidResponse(let details, let statusCode):
            return CloudAuthFailureDiagnosticsFields(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return CloudAuthFailureDiagnosticsFields(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    if let guestAuthError = error as? GuestCloudAuthError {
        switch guestAuthError {
        case .invalidResponse(let details, let statusCode):
            return CloudAuthFailureDiagnosticsFields(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return CloudAuthFailureDiagnosticsFields(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    return CloudAuthFailureDiagnosticsFields(statusCode: nil, backendCode: nil, requestId: nil)
}
