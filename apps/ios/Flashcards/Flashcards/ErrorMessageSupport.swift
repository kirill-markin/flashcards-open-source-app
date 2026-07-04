import Foundation

struct ObservedTechnicalError: LocalizedError {
    let underlyingError: Error

    var errorDescription: String? {
        errorMessage(error: self.underlyingError)
    }
}

func markTechnicalErrorObserved(error: Error) -> Error {
    if isTechnicalErrorObserved(error: error) {
        return error
    }
    return ObservedTechnicalError(underlyingError: error)
}

func isTechnicalErrorObserved(error: Error) -> Bool {
    error is ObservedTechnicalError
}

func technicalErrorPresentationSource(error: Error) -> Error {
    if let observedError = error as? ObservedTechnicalError {
        return observedError.underlyingError
    }
    return error
}

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
    if let observedError = error as? ObservedTechnicalError {
        return errorMessage(error: observedError.underlyingError)
    }

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
    if let observedError = error as? ObservedTechnicalError {
        return technicalErrorDetails(error: observedError.underlyingError)
    }

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

private let iosNetworkTransportDiagnosticsUnderlyingErrorDepth: Int = 4
private let iosNetworkTransportOfficialAPIHost: String = "api.flashcards-open-source-app.com"
private let cfStreamErrorDomainUserInfoKey: String = "_kCFStreamErrorDomainKey"
private let cfStreamErrorCodeUserInfoKey: String = "_kCFStreamErrorCodeKey"

private struct IOSNetworkTransportAPIHostDiagnostics {
    let kind: String?
    let host: String?
}

private struct IOSNetworkTransportCFStreamErrorDiagnostics {
    let domain: Int?
    let code: Int?
}

func makeIOSNetworkTransportDiagnostics(
    error: Error,
    httpMethod: String?,
    endpointPath: String?,
    apiBaseUrl: String?
) -> IOSNetworkTransportDiagnostics {
    let nsError: NSError = error as NSError
    let urlErrorCode: URLError.Code? = flashcardsURLErrorCode(
        error: error,
        remainingDepth: iosNetworkTransportDiagnosticsUnderlyingErrorDepth
    )
    let cfStreamError: IOSNetworkTransportCFStreamErrorDiagnostics = iosNetworkTransportCFStreamErrorDiagnostics(
        error: error,
        remainingDepth: iosNetworkTransportDiagnosticsUnderlyingErrorDepth
    )
    let apiHost: IOSNetworkTransportAPIHostDiagnostics = iosNetworkTransportAPIHostDiagnostics(
        apiBaseUrl: apiBaseUrl
    ) ?? IOSNetworkTransportAPIHostDiagnostics(kind: nil, host: nil)

    return IOSNetworkTransportDiagnostics(
        nsErrorDomain: safeIOSNetworkTransportIdentifier(nsError.domain),
        nsErrorCode: nsError.code,
        urlErrorCode: urlErrorCode?.rawValue,
        urlErrorName: urlErrorCode.flatMap { code in iosNetworkTransportURLErrorName(code: code) },
        cfStreamErrorDomain: cfStreamError.domain,
        cfStreamErrorCode: cfStreamError.code,
        httpMethod: httpMethod.flatMap { method in safeIOSNetworkTransportHTTPMethod(method) },
        endpointPath: endpointPath.flatMap { path in safeIOSNetworkTransportEndpointPath(path) },
        apiHostKind: apiHost.kind,
        apiHost: apiHost.host
    )
}

private func iosNetworkTransportURLErrorName(code: URLError.Code) -> String? {
    switch code {
    case .timedOut:
        return "timed_out"
    case .cannotFindHost:
        return "cannot_find_host"
    case .cannotConnectToHost:
        return "cannot_connect_to_host"
    case .dnsLookupFailed:
        return "dns_lookup_failed"
    case .networkConnectionLost:
        return "network_connection_lost"
    case .notConnectedToInternet:
        return "not_connected_to_internet"
    case .internationalRoamingOff:
        return "international_roaming_off"
    case .callIsActive:
        return "call_is_active"
    case .dataNotAllowed:
        return "data_not_allowed"
    case .cannotLoadFromNetwork:
        return "cannot_load_from_network"
    case .cancelled:
        return "cancelled"
    default:
        return nil
    }
}

private func iosNetworkTransportCFStreamErrorDiagnostics(
    error: Error,
    remainingDepth: Int
) -> IOSNetworkTransportCFStreamErrorDiagnostics {
    let nsError: NSError = error as NSError
    let domain: Int? = iosNetworkTransportUserInfoInteger(
        nsError.userInfo[cfStreamErrorDomainUserInfoKey]
    )
    let code: Int? = iosNetworkTransportUserInfoInteger(
        nsError.userInfo[cfStreamErrorCodeUserInfoKey]
    )
    if domain != nil || code != nil {
        return IOSNetworkTransportCFStreamErrorDiagnostics(domain: domain, code: code)
    }

    guard remainingDepth > 0 else {
        return IOSNetworkTransportCFStreamErrorDiagnostics(domain: nil, code: nil)
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return IOSNetworkTransportCFStreamErrorDiagnostics(domain: nil, code: nil)
    }

    return iosNetworkTransportCFStreamErrorDiagnostics(
        error: underlyingError,
        remainingDepth: remainingDepth - 1
    )
}

private func iosNetworkTransportUserInfoInteger(_ value: Any?) -> Int? {
    if let intValue = value as? Int {
        return intValue
    }
    if let numberValue = value as? NSNumber {
        return numberValue.intValue
    }
    if let stringValue = value as? String {
        return Int(stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return nil
}

private func safeIOSNetworkTransportHTTPMethod(_ httpMethod: String) -> String? {
    let normalizedMethod: String = httpMethod
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .uppercased()
    return safeIOSNetworkTransportIdentifier(normalizedMethod)
}

private func safeIOSNetworkTransportEndpointPath(_ endpointPath: String) -> String? {
    let trimmedPath: String = endpointPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedPath.isEmpty == false else {
        return nil
    }

    let rawPath: String
    if let components = URLComponents(string: trimmedPath) {
        if components.path.isEmpty == false {
            rawPath = components.path
        } else if components.scheme != nil || components.host != nil {
            return nil
        } else {
            rawPath = fallbackIOSNetworkTransportEndpointPath(trimmedPath)
        }
    } else {
        guard trimmedPath.contains("://") == false else {
            return nil
        }
        rawPath = fallbackIOSNetworkTransportEndpointPath(trimmedPath)
    }
    let normalizedPath: String = rawPath.hasPrefix("/") ? rawPath : "/\(rawPath)"
    guard normalizedPath.count <= 240 else {
        return nil
    }

    let redactedPath: String = normalizedPath
        .split(separator: "/", omittingEmptySubsequences: false)
        .map { segment in
            let segmentValue: String = String(segment)
            guard shouldRedactIOSNetworkTransportEndpointPathSegment(segmentValue) else {
                return segmentValue
            }
            return filteredDiagnosticValue
        }
        .joined(separator: "/")
    guard redactedPath.rangeOfCharacter(from: iosNetworkTransportEndpointPathAllowedCharacters.inverted) == nil else {
        return nil
    }
    return redactedPath
}

private func fallbackIOSNetworkTransportEndpointPath(_ endpointPath: String) -> String {
    let queryStrippedPath: String = endpointPath
        .split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        .first
        .map(String.init) ?? ""
    return queryStrippedPath
        .split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
        .first
        .map(String.init) ?? ""
}

private let iosNetworkTransportEndpointPathAllowedCharacters: CharacterSet = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~:/-%[]"
)

private func shouldRedactIOSNetworkTransportEndpointPathSegment(_ segment: String) -> Bool {
    let decodedSegment: String = segment.removingPercentEncoding ?? segment
    guard decodedSegment.isEmpty == false else {
        return false
    }

    if decodedSegment.range(
        of: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#,
        options: .regularExpression
    ) != nil {
        return true
    }

    if decodedSegment.count >= 20,
       decodedSegment.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil {
        return true
    }

    return safeIOSNetworkTransportIdentifier(decodedSegment) == nil
}

private func iosNetworkTransportAPIHostDiagnostics(
    apiBaseUrl: String?
) -> IOSNetworkTransportAPIHostDiagnostics? {
    guard let apiBaseUrl else {
        return nil
    }
    let trimmedBaseUrl: String = apiBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: trimmedBaseUrl),
          let rawHost = components.host else {
        return nil
    }

    let normalizedHost: String = rawHost.lowercased()
    if normalizedHost == iosNetworkTransportOfficialAPIHost {
        return IOSNetworkTransportAPIHostDiagnostics(
            kind: "official",
            host: iosNetworkTransportOfficialAPIHost
        )
    }

    return IOSNetworkTransportAPIHostDiagnostics(
        kind: "custom",
        host: safeIOSNetworkTransportIdentifier(normalizedHost)
    )
}

private func safeIOSNetworkTransportIdentifier(_ value: String) -> String? {
    let candidate: String = safeDiagnosticIdentifier(value)
    guard candidate != filteredDiagnosticValue else {
        return nil
    }
    return candidate
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

    if isRetryableNetworkTransportFailure(error: error) {
        return CloudAuthInlineErrorPresentation(
            message: makeCloudAuthTransportFailureMessage(context: context),
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
