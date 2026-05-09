import Foundation

private let aiChatBootstrapRetryMaxAttempts = 3
private let aiChatBootstrapRetryDelayNanoseconds: [UInt64] = [
    300_000_000,
    900_000_000
]

struct AIChatBootstrapErrorPresentation: Hashable, Sendable {
    let message: String
    let technicalDetails: String?
}

struct AIChatBootstrapLoadResult: Sendable {
    let session: CloudLinkedSession
    let response: AIChatBootstrapResponse
}

func makeAIChatBootstrapErrorPresentation(error: Error) -> AIChatBootstrapErrorPresentation {
    makeAIChatBootstrapErrorPresentation(
        error: error,
        showsLocalValidationMessage: false
    )
}

func makeAIChatBootstrapErrorPresentation(
    error: Error,
    showsLocalValidationMessage: Bool
) -> AIChatBootstrapErrorPresentation {
    if
        showsLocalValidationMessage,
        let localStoreError = error as? LocalStoreError,
        case .validation(let message) = localStoreError,
        message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    {
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.accountStatusMessage",
                "AI chat needs your cloud account status to be resolved before it can load."
            ),
            technicalDetails: aiChatBootstrapLocalValidationTechnicalDetails(message: message)
        )
    }

    if
        let urlErrorCode = aiChatBootstrapURLErrorCode(error: error, remainingDepth: 4),
        aiChatBootstrapShouldShowNetworkMessage(urlErrorCode)
    {
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.networkMessage",
                "The connection was interrupted while loading AI chat. Check your connection and try again."
            ),
            technicalDetails: aiChatBootstrapURLErrorTechnicalDetails(code: urlErrorCode)
        )
    }

    if let urlErrorCode = aiChatBootstrapURLErrorCode(error: error, remainingDepth: 4) {
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.message",
                "Failed to load AI chat."
            ),
            technicalDetails: aiChatBootstrapURLErrorTechnicalDetails(code: urlErrorCode)
        )
    }

    if let serviceError = error as? AIChatServiceError {
        return makeAIChatBootstrapServiceErrorPresentation(error: serviceError)
    }

    if let diagnosticError = error as? AIChatFailureDiagnosticProviding {
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.message",
                "Failed to load AI chat."
            ),
            technicalDetails: aiChatFailureTechnicalDetails(
                error: error,
                diagnostics: diagnosticError.diagnostics,
                code: nil,
                statusCode: nil,
                requestId: nil
            )
        )
    }

    return AIChatBootstrapErrorPresentation(
        message: aiSettingsLocalized(
            "ai.failed.message",
            "Failed to load AI chat."
        ),
        technicalDetails: aiChatBootstrapErrorTypeTechnicalDetails(error: error)
    )
}

func aiChatBootstrapShouldRetry(error: Error) -> Bool {
    if isAIChatRequestCancellationError(error: error) {
        return false
    }

    if isAIChatRetryableTransportFailure(error: error) {
        return true
    }

    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    switch serviceError {
    case .invalidResponse(_, _, let diagnostics):
        guard let statusCode = diagnostics.statusCode else {
            return false
        }
        return aiChatBootstrapCanRetryHTTPStatus(statusCode)
    case .invalidBaseUrl, .invalidHttpResponse, .invalidPayload:
        return false
    }
}

func aiChatBootstrapRetryDelay(attemptIndex: Int) -> UInt64 {
    let boundedIndex = max(0, min(attemptIndex, aiChatBootstrapRetryDelayNanoseconds.count - 1))
    let baseDelay = aiChatBootstrapRetryDelayNanoseconds[boundedIndex]
    let jitterUpperBound = baseDelay / 5
    return baseDelay + UInt64.random(in: 0...jitterUpperBound)
}

func aiChatBootstrapAllowsRetry(nextAttemptNumber: Int, error: Error) -> Bool {
    nextAttemptNumber < aiChatBootstrapRetryMaxAttempts && aiChatBootstrapShouldRetry(error: error)
}

private func makeAIChatBootstrapServiceErrorPresentation(
    error: AIChatServiceError
) -> AIChatBootstrapErrorPresentation {
    switch error {
    case .invalidBaseUrl(_, let diagnostics):
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.error.summary.configuration",
                "AI Configuration Error"
            ),
            technicalDetails: aiChatFailureTechnicalDetails(
                error: error,
                diagnostics: diagnostics,
                code: nil,
                statusCode: nil,
                requestId: nil
            )
        )
    case .invalidHttpResponse(let diagnostics):
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.message",
                "Failed to load AI chat."
            ),
            technicalDetails: aiChatFailureTechnicalDetails(
                error: error,
                diagnostics: diagnostics,
                code: nil,
                statusCode: nil,
                requestId: nil
            )
        )
    case .invalidResponse(let errorDetails, let message, let diagnostics):
        return AIChatBootstrapErrorPresentation(
            message: aiChatBootstrapServiceMessage(
                errorDetails: errorDetails,
                serviceMessage: message
            ),
            technicalDetails: aiChatFailureTechnicalDetails(
                error: error,
                diagnostics: diagnostics,
                code: errorDetails.code,
                statusCode: diagnostics.statusCode,
                requestId: errorDetails.requestId
            )
        )
    case .invalidPayload(_, let diagnostics):
        return AIChatBootstrapErrorPresentation(
            message: aiSettingsLocalized(
                "ai.failed.message",
                "Failed to load AI chat."
            ),
            technicalDetails: aiChatFailureTechnicalDetails(
                error: error,
                diagnostics: diagnostics,
                code: nil,
                statusCode: nil,
                requestId: nil
            )
        )
    }
}

private func aiChatBootstrapServiceMessage(
    errorDetails: CloudApiErrorDetails,
    serviceMessage: String
) -> String {
    if let code = errorDetails.code, isAIChatAvailabilityErrorCode(code: code, surface: .chat) {
        let messageWithoutStatus = aiChatBootstrapStripServiceStatusPrefix(serviceMessage)
        return aiChatBootstrapStripServiceRequestReference(
            messageWithoutStatus,
            requestId: errorDetails.requestId
        )
    }

    return aiSettingsLocalized(
        "ai.failed.message",
        "Failed to load AI chat."
    )
}

private func aiChatBootstrapStripServiceStatusPrefix(_ message: String) -> String {
    let prefix = "AI chat request failed with status "
    guard message.hasPrefix(prefix) else {
        return message
    }

    let suffix = String(message.dropFirst(prefix.count))
    guard let separatorRange = suffix.range(of: ": ") else {
        return message
    }

    return String(suffix[separatorRange.upperBound...])
}

private func aiChatBootstrapStripServiceRequestReference(_ message: String, requestId: String?) -> String {
    guard let requestId, requestId.isEmpty == false else {
        return message
    }

    let suffix = " Reference: \(requestId)"
    guard message.hasSuffix(suffix) else {
        return message
    }

    return String(message.dropLast(suffix.count))
}

private func aiChatFailureTechnicalDetails(
    error: Error,
    diagnostics: AIChatFailureDiagnostics?,
    code: String?,
    statusCode: Int?,
    requestId: String?
) -> String {
    var detailLines: [String] = []

    let effectiveRequestId = requestId ?? diagnostics?.backendRequestId
    if let effectiveRequestId, effectiveRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.reference",
                "Reference: %@",
                effectiveRequestId
            )
        )
    } else if let clientRequestId = diagnostics?.clientRequestId, clientRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.debug",
                "Debug: %@",
                clientRequestId
            )
        )
    }

    let effectiveStatusCode = statusCode ?? diagnostics?.statusCode
    if let effectiveStatusCode {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.status",
                "Status: %d",
                effectiveStatusCode
            )
        )
    }

    let effectiveCode = code
    if let effectiveCode, effectiveCode.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.code",
                "Code: %@",
                effectiveCode
            )
        )
    }

    if let stage = diagnostics?.stage {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.stage",
                "Stage: %@",
                stage.rawValue
            )
        )
    }

    if let decoderSummary = diagnostics?.decoderSummary, decoderSummary.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.details",
                "Details: %@",
                decoderSummary
            )
        )
    }

    if detailLines.isEmpty {
        detailLines.append(aiChatBootstrapErrorTypeLine(error: error))
    }

    return detailLines.joined(separator: "\n")
}

private func aiChatBootstrapCanRetryHTTPStatus(_ statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

private func isAIChatRetryableTransportFailure(error: Error) -> Bool {
    guard let urlErrorCode = aiChatBootstrapURLErrorCode(error: error, remainingDepth: 4) else {
        return false
    }

    return aiChatBootstrapCanRetryURLErrorCode(urlErrorCode)
}

private func aiChatBootstrapCanRetryURLErrorCode(_ code: URLError.Code) -> Bool {
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

private func aiChatBootstrapShouldShowNetworkMessage(_ code: URLError.Code) -> Bool {
    switch code {
    case .cancelled,
         .badURL,
         .unsupportedURL,
         .userAuthenticationRequired,
         .userCancelledAuthentication,
         .appTransportSecurityRequiresSecureConnection:
        return false
    default:
        return true
    }
}

private func aiChatBootstrapURLErrorCode(error: Error, remainingDepth: Int) -> URLError.Code? {
    if let urlError = error as? URLError {
        return urlError.code
    }

    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain {
        return URLError.Code(rawValue: nsError.code)
    }

    guard remainingDepth > 0 else {
        return nil
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return nil
    }

    return aiChatBootstrapURLErrorCode(error: underlyingError, remainingDepth: remainingDepth - 1)
}

private func aiChatBootstrapURLErrorTechnicalDetails(code: URLError.Code) -> String {
    [
        aiChatBootstrapTypeLine(typeName: "URLError"),
        aiSettingsLocalizedFormat(
            "ai.error.detail.code",
            "Code: %@",
            aiChatBootstrapURLErrorCodeDescription(code)
        )
    ].joined(separator: "\n")
}

private func aiChatBootstrapErrorTypeTechnicalDetails(error: Error) -> String {
    aiChatBootstrapErrorTypeLine(error: error)
}

private func aiChatBootstrapLocalValidationTechnicalDetails(message: String) -> String {
    var detailLines: [String] = [
        aiChatBootstrapTypeLine(typeName: "LocalStoreError")
    ]

    if let reason = aiChatBootstrapSafeSingleLineReason(message: message) {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.reason",
                "Reason: %@",
                reason
            )
        )
    }

    return detailLines.joined(separator: "\n")
}

private func aiChatBootstrapErrorTypeLine(error: Error) -> String {
    aiChatBootstrapTypeLine(typeName: aiChatBootstrapErrorTypeName(error: error))
}

private func aiChatBootstrapTypeLine(typeName: String) -> String {
    aiSettingsLocalizedFormat(
        "ai.error.detail.type",
        "Type: %@",
        typeName
    )
}

private func aiChatBootstrapErrorTypeName(error: Error) -> String {
    let reflectedTypeName = String(reflecting: type(of: error))
    guard let shortName = reflectedTypeName.split(separator: ".").last else {
        return reflectedTypeName
    }

    return String(shortName)
}

private func aiChatBootstrapSafeSingleLineReason(message: String) -> String? {
    let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedMessage.isEmpty == false else {
        return nil
    }

    guard trimmedMessage.contains("{") == false, trimmedMessage.contains("}") == false else {
        return nil
    }

    let collapsedMessage = trimmedMessage
        .split(whereSeparator: { character in
            character.isWhitespace || character.isNewline
        })
        .joined(separator: " ")

    let maxReasonLength = 240
    guard collapsedMessage.count > maxReasonLength else {
        return collapsedMessage
    }

    let endIndex = collapsedMessage.index(collapsedMessage.startIndex, offsetBy: maxReasonLength)
    return String(collapsedMessage[..<endIndex]) + "..."
}

private func aiChatBootstrapURLErrorCodeDescription(_ code: URLError.Code) -> String {
    guard let codeName = aiChatBootstrapURLErrorCodeName(code) else {
        return String(code.rawValue)
    }

    return "\(codeName) (\(code.rawValue))"
}

private func aiChatBootstrapURLErrorCodeName(_ code: URLError.Code) -> String? {
    switch code {
    case .unknown:
        return "unknown"
    case .cancelled:
        return "cancelled"
    case .badURL:
        return "badURL"
    case .timedOut:
        return "timedOut"
    case .unsupportedURL:
        return "unsupportedURL"
    case .cannotFindHost:
        return "cannotFindHost"
    case .cannotConnectToHost:
        return "cannotConnectToHost"
    case .networkConnectionLost:
        return "networkConnectionLost"
    case .dnsLookupFailed:
        return "dnsLookupFailed"
    case .httpTooManyRedirects:
        return "httpTooManyRedirects"
    case .resourceUnavailable:
        return "resourceUnavailable"
    case .notConnectedToInternet:
        return "notConnectedToInternet"
    case .redirectToNonExistentLocation:
        return "redirectToNonExistentLocation"
    case .badServerResponse:
        return "badServerResponse"
    case .userCancelledAuthentication:
        return "userCancelledAuthentication"
    case .userAuthenticationRequired:
        return "userAuthenticationRequired"
    case .zeroByteResource:
        return "zeroByteResource"
    case .cannotDecodeRawData:
        return "cannotDecodeRawData"
    case .cannotDecodeContentData:
        return "cannotDecodeContentData"
    case .cannotParseResponse:
        return "cannotParseResponse"
    case .appTransportSecurityRequiresSecureConnection:
        return "appTransportSecurityRequiresSecureConnection"
    case .fileDoesNotExist:
        return "fileDoesNotExist"
    case .fileIsDirectory:
        return "fileIsDirectory"
    case .noPermissionsToReadFile:
        return "noPermissionsToReadFile"
    case .dataLengthExceedsMaximum:
        return "dataLengthExceedsMaximum"
    case .secureConnectionFailed:
        return "secureConnectionFailed"
    case .serverCertificateHasBadDate:
        return "serverCertificateHasBadDate"
    case .serverCertificateUntrusted:
        return "serverCertificateUntrusted"
    case .serverCertificateHasUnknownRoot:
        return "serverCertificateHasUnknownRoot"
    case .serverCertificateNotYetValid:
        return "serverCertificateNotYetValid"
    case .clientCertificateRejected:
        return "clientCertificateRejected"
    case .clientCertificateRequired:
        return "clientCertificateRequired"
    case .cannotLoadFromNetwork:
        return "cannotLoadFromNetwork"
    case .cannotCreateFile:
        return "cannotCreateFile"
    case .cannotOpenFile:
        return "cannotOpenFile"
    case .cannotCloseFile:
        return "cannotCloseFile"
    case .cannotWriteToFile:
        return "cannotWriteToFile"
    case .cannotRemoveFile:
        return "cannotRemoveFile"
    case .cannotMoveFile:
        return "cannotMoveFile"
    case .downloadDecodingFailedMidStream:
        return "downloadDecodingFailedMidStream"
    case .downloadDecodingFailedToComplete:
        return "downloadDecodingFailedToComplete"
    case .internationalRoamingOff:
        return "internationalRoamingOff"
    case .callIsActive:
        return "callIsActive"
    case .dataNotAllowed:
        return "dataNotAllowed"
    case .requestBodyStreamExhausted:
        return "requestBodyStreamExhausted"
    case .backgroundSessionRequiresSharedContainer:
        return "backgroundSessionRequiresSharedContainer"
    case .backgroundSessionInUseByAnotherProcess:
        return "backgroundSessionInUseByAnotherProcess"
    case .backgroundSessionWasDisconnected:
        return "backgroundSessionWasDisconnected"
    default:
        return nil
    }
}
