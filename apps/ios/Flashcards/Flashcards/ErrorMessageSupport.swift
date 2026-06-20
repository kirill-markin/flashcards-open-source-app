import Foundation

struct CloudAuthInlineErrorPresentation {
    let message: String
    let technicalError: TechnicalErrorAction?
}

enum TechnicalErrorCapturePolicy: Equatable {
    case captureOnPresentation
    case alreadyCaptured
}

struct TechnicalErrorAction: Identifiable {
    let id: String
    let error: Error
    let capturePolicy: TechnicalErrorCapturePolicy

    init(error: Error, capturePolicy: TechnicalErrorCapturePolicy) {
        self.id = UUID().uuidString
        self.error = error
        self.capturePolicy = capturePolicy
    }
}

struct TechnicalErrorCaptureContext: Hashable, Sendable {
    let id: String

    init() {
        self.id = UUID().uuidString
    }
}

enum CloudAuthInlineErrorContext {
    case sendCode
    case verifyCode
}

func errorMessage(error: Error) -> String {
    if let localizedError = error as? LocalizedError, let description = localizedError.errorDescription {
        return description
    }

    return String(describing: error)
}

func makeTechnicalErrorPresentation(error: Error) -> TechnicalErrorPresentation {
    makeTechnicalErrorPresentation(
        id: UUID().uuidString.lowercased(),
        technicalDetails: technicalErrorDetails(error: error)
    )
}

func technicalErrorDetails(error: Error) -> String {
    if let authError = error as? CloudAuthError {
        return cloudAuthTechnicalErrorDetails(error: authError)
    }

    if let guestAuthError = error as? GuestCloudAuthError {
        return guestCloudAuthTechnicalErrorDetails(error: guestAuthError)
    }

    if let syncError = error as? CloudSyncError {
        return cloudSyncTechnicalErrorDetails(error: syncError)
    }

    return genericTechnicalErrorDetails(error: error)
}

func makeTechnicalErrorAction(error: Error) -> TechnicalErrorAction {
    TechnicalErrorAction(
        error: error,
        capturePolicy: .captureOnPresentation
    )
}

func makeTechnicalErrorAction(error: Error, capturePolicy: TechnicalErrorCapturePolicy) -> TechnicalErrorAction {
    TechnicalErrorAction(
        error: error,
        capturePolicy: capturePolicy
    )
}

func isRequestCancellationError(error: Error) -> Bool {
    if error is CancellationError {
        return true
    }

    if let urlError = error as? URLError {
        return urlError.code == .cancelled
    }

    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
        return true
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return false
    }

    return isRequestCancellationError(error: underlyingError)
}

func flashcardsURLErrorCode(error: Error, remainingDepth: Int) -> URLError.Code? {
    if let urlError = error as? URLError {
        return urlError.code
    }

    let nsError: NSError = error as NSError
    if nsError.domain == NSURLErrorDomain {
        return URLError.Code(rawValue: nsError.code)
    }

    guard remainingDepth > 0 else {
        return nil
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return nil
    }

    return flashcardsURLErrorCode(error: underlyingError, remainingDepth: remainingDepth - 1)
}

func isRetryableNetworkTransportFailure(error: Error) -> Bool {
    guard let urlErrorCode: URLError.Code = flashcardsURLErrorCode(error: error, remainingDepth: 4) else {
        return false
    }

    return isRetryableNetworkTransportFailure(code: urlErrorCode)
}

func isRetryableNetworkTransportFailure(code: URLError.Code) -> Bool {
    switch code {
    case .timedOut,
         .cannotFindHost,
         .cannotConnectToHost,
         .dnsLookupFailed,
         .networkConnectionLost,
         .notConnectedToInternet,
         .internationalRoamingOff,
         .callIsActive,
         .dataNotAllowed,
         .cannotLoadFromNetwork:
        return true
    default:
        return false
    }
}

func makeCloudAuthInlineErrorPresentation(
    error: Error,
    context: CloudAuthInlineErrorContext
) -> CloudAuthInlineErrorPresentation {
    if isUserActionableCloudAuthFailure(error: error) {
        return CloudAuthInlineErrorPresentation(
            message: errorMessage(error: error),
            technicalError: nil
        )
    }

    if isCloudAuthTransportFailure(error: error) {
        return CloudAuthInlineErrorPresentation(
            message: makeCloudAuthTransportFailureMessage(context: context),
            technicalError: TechnicalErrorAction(
                error: error,
                capturePolicy: .captureOnPresentation
            )
        )
    }

    return CloudAuthInlineErrorPresentation(
        message: makeCloudAuthTechnicalFailureMessage(context: context),
        technicalError: TechnicalErrorAction(
            error: error,
            capturePolicy: .captureOnPresentation
        )
    )
}

private func makeCloudAuthTransportFailureMessage(context: CloudAuthInlineErrorContext) -> String {
    switch context {
    case .sendCode:
        return String(
            localized: "cloud_auth.error.transport.send_code_interrupted",
            table: "Foundation",
            comment: "Cloud auth inline error when the network connection drops while sending the OTP code"
        )
    case .verifyCode:
        return String(
            localized: "cloud_auth.error.transport.verify_code_interrupted",
            table: "Foundation",
            comment: "Cloud auth inline error when the network connection drops while verifying the OTP code"
        )
    }
}

private func isCloudAuthTransportFailure(error: Error) -> Bool {
    return flashcardsURLErrorCode(error: error, remainingDepth: 4) != nil
}

private func makeCloudAuthTechnicalFailureMessage(context: CloudAuthInlineErrorContext) -> String {
    switch context {
    case .sendCode:
        return String(
            localized: "cloud_auth.error.otp_send_failed",
            table: "Foundation",
            comment: "Cloud auth error when sending the OTP code failed"
        )
    case .verifyCode:
        return String(
            localized: "cloud_auth.error.otp_verify_failed",
            table: "Foundation",
            comment: "Cloud auth error when verifying the OTP code failed"
        )
    }
}

private func isUserActionableCloudAuthFailure(error: Error) -> Bool {
    guard let authError = error as? CloudAuthError else {
        return false
    }

    switch authError {
    case .invalidResponse(let details, _):
        guard let code = details.code else {
            return false
        }

        return userActionableCloudAuthBackendCodes.contains(code)
    case .invalidBaseUrl, .invalidResponseBody:
        return false
    }
}

private let userActionableCloudAuthBackendCodes: Set<String> = [
    "INVALID_EMAIL",
    "OTP_CHALLENGE_CONSUMED",
    "OTP_CODE_INVALID",
    "OTP_SESSION_EXPIRED",
    "OTP_TOO_MANY_ATTEMPTS"
]

private func cloudAuthTechnicalErrorDetails(error: CloudAuthError) -> String {
    switch error {
    case .invalidBaseUrl(let authBaseUrl):
        return [
            "Type: CloudAuthError.invalidBaseUrl",
            "Auth base URL: \(authBaseUrl)"
        ].joined(separator: "\n")
    case .invalidResponse(let details, let statusCode):
        return cloudApiTechnicalErrorDetails(
            type: "CloudAuthError.invalidResponse",
            details: details,
            statusCode: statusCode
        )
    case .invalidResponseBody(let body):
        return [
            "Type: CloudAuthError.invalidResponseBody",
            "Response body: \(body)"
        ].joined(separator: "\n")
    }
}

private func guestCloudAuthTechnicalErrorDetails(error: GuestCloudAuthError) -> String {
    switch error {
    case .invalidBaseUrl(let apiBaseUrl):
        return [
            "Type: GuestCloudAuthError.invalidBaseUrl",
            "API base URL: \(apiBaseUrl)"
        ].joined(separator: "\n")
    case .invalidResponse(let details, let statusCode):
        return cloudApiTechnicalErrorDetails(
            type: "GuestCloudAuthError.invalidResponse",
            details: details,
            statusCode: statusCode
        )
    case .invalidResponseBody(let body):
        return [
            "Type: GuestCloudAuthError.invalidResponseBody",
            "Response body: \(body)"
        ].joined(separator: "\n")
    }
}

private func cloudSyncTechnicalErrorDetails(error: CloudSyncError) -> String {
    switch error {
    case .invalidBaseUrl(let apiBaseUrl):
        return [
            "Type: CloudSyncError.invalidBaseUrl",
            "API base URL: \(apiBaseUrl)"
        ].joined(separator: "\n")
    case .invalidResponse(let details, let statusCode):
        return cloudApiTechnicalErrorDetails(
            type: "CloudSyncError.invalidResponse",
            details: details,
            statusCode: statusCode
        )
    }
}

private func cloudApiTechnicalErrorDetails(
    type: String,
    details: CloudApiErrorDetails,
    statusCode: Int
) -> String {
    var lines: [String] = [
        "Type: \(type)",
        "Status: \(statusCode)",
        "Message: \(details.message)"
    ]

    if let code = details.code {
        lines.append("Code: \(code)")
    }

    if let requestId = details.requestId {
        lines.append("Request ID: \(requestId)")
    }

    if let syncConflict = details.syncConflict {
        lines.append("Sync conflict phase: \(syncConflict.phase)")
        lines.append("Sync conflict entity: \(syncConflict.entityType.rawValue)")
        lines.append("Sync conflict entity ID: \(syncConflict.entityId)")
        lines.append("Sync conflict recoverable: \(syncConflict.recoverable)")
    }

    return lines.joined(separator: "\n")
}

private func genericTechnicalErrorDetails(error: Error) -> String {
    let nsError = error as NSError
    var lines: [String] = [
        "Type: \(String(reflecting: error))",
        "Domain: \(nsError.domain)",
        "Code: \(nsError.code)",
        "Description: \(nsError.localizedDescription)"
    ]

    if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error {
        lines.append("Underlying error:")
        lines.append(genericTechnicalErrorDetails(error: underlyingError))
    }

    return lines.joined(separator: "\n")
}
