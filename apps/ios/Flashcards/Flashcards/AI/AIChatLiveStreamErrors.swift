import Foundation

enum AIChatLiveStreamError: LocalizedError {
    case invalidUrl(String, clientRequestId: String)
    case invalidResponse(clientRequestId: String)
    case transportFailure(underlyingError: Error, requestId: String?, clientRequestId: String)
    case staleStream(idleTimeoutSeconds: TimeInterval, requestId: String?, clientRequestId: String)
    case invalidStatusCode(
        httpStatusCode: Int,
        errorDetails: CloudApiErrorDetails,
        configurationMode: CloudServiceConfigurationMode,
        clientRequestId: String
    )

    var errorDescription: String? {
        switch self {
        case .invalidUrl:
            return "AI live stream URL is invalid."
        case .invalidResponse:
            return "AI live stream did not receive an HTTP response."
        case .transportFailure(let underlyingError, _, _):
            return "AI live stream network request failed: \(underlyingError.localizedDescription)"
        case .staleStream:
            return "AI response stopped updating before the run finished."
        case .invalidStatusCode(let httpStatusCode, let errorDetails, let configurationMode, _):
            let message = makeAIChatUserFacingErrorMessage(
                rawMessage: errorDetails.message,
                code: errorDetails.code,
                requestId: errorDetails.requestId,
                configurationMode: configurationMode,
                surface: .chat
            )
            return "AI live stream failed with status \(httpStatusCode): \(message)"
        }
    }
}

func makeAIChatLiveStreamURL(
    liveUrl: String,
    sessionId: String,
    runId: String,
    afterCursor: String?,
    clientRequestId: String
) throws -> URL {
    guard var components = URLComponents(string: liveUrl) else {
        throw AIChatLiveStreamError.invalidUrl(liveUrl, clientRequestId: clientRequestId)
    }

    var queryItems = components.queryItems ?? []
    queryItems.removeAll { item in
        item.name == "sessionId" || item.name == "runId" || item.name == "afterCursor"
    }
    queryItems.append(URLQueryItem(name: "sessionId", value: sessionId))
    queryItems.append(URLQueryItem(name: "runId", value: runId))
    if let afterCursor, afterCursor.isEmpty == false {
        queryItems.append(URLQueryItem(name: "afterCursor", value: afterCursor))
    }
    components.queryItems = queryItems

    guard let url = components.url else {
        throw AIChatLiveStreamError.invalidUrl(liveUrl, clientRequestId: clientRequestId)
    }

    return url
}

func extractAIChatLiveRequestId(httpResponse: HTTPURLResponse) -> String? {
    let chatRequestId = httpResponse.value(forHTTPHeaderField: "X-Chat-Request-Id")
    if let chatRequestId, chatRequestId.isEmpty == false {
        return chatRequestId
    }

    let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
    if let requestId, requestId.isEmpty == false {
        return requestId
    }

    return nil
}

private func aiChatLiveTruncatedSnippet(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.count > 240 else {
        return trimmedValue
    }

    return String(trimmedValue.prefix(240))
}

func aiChatErrorLogMetadata(error: Error) -> [String: String] {
    if let liveStreamError = error as? AIChatLiveStreamError {
        switch liveStreamError {
        case .invalidUrl(_, let clientRequestId):
            return [
                "failureKind": "local_contract_failure",
                "stage": AIChatFailureStage.requestBuild.rawValue,
                "errorKind": AIChatFailureKind.invalidBaseUrl.rawValue,
                "clientRequestId": clientRequestId,
            ]
        case .invalidResponse(let clientRequestId):
            return [
                "failureKind": "transport_failure",
                "stage": AIChatFailureStage.invalidHttpResponse.rawValue,
                "errorKind": AIChatFailureKind.invalidHttpResponse.rawValue,
                "clientRequestId": clientRequestId,
            ]
        case .transportFailure(let underlyingError, let requestId, let clientRequestId):
            let nsError = underlyingError as NSError
            var metadata: [String: String] = [
                "failureKind": "transport_failure",
                "stage": AIChatFailureStage.invalidHttpResponse.rawValue,
                "errorKind": AIChatFailureKind.invalidHttpResponse.rawValue,
                "clientRequestId": clientRequestId,
                "errorDomain": nsError.domain,
                "errorCode": String(nsError.code),
            ]
            if let requestId, requestId.isEmpty == false {
                metadata["backendRequestId"] = requestId
            }
            return metadata
        case .staleStream(let idleTimeoutSeconds, let requestId, let clientRequestId):
            var metadata: [String: String] = [
                "failureKind": "transport_stale_stream",
                "stage": AIChatFailureStage.readingLine.rawValue,
                "errorKind": AIChatFailureKind.staleStream.rawValue,
                "idleTimeoutSeconds": String(idleTimeoutSeconds),
                "clientRequestId": clientRequestId,
            ]
            if let requestId, requestId.isEmpty == false {
                metadata["backendRequestId"] = requestId
            }
            return metadata
        case .invalidStatusCode(let httpStatusCode, let errorDetails, _, let clientRequestId):
            var metadata: [String: String] = [
                "failureKind": "backend_http_failure",
                "statusCode": String(httpStatusCode),
                "stage": AIChatFailureStage.responseNotOk.rawValue,
                "errorKind": AIChatFailureKind.invalidHttpResponse.rawValue,
                "clientRequestId": clientRequestId,
            ]
            if let requestId = errorDetails.requestId, requestId.isEmpty == false {
                metadata["backendRequestId"] = requestId
            }
            if let code = errorDetails.code, code.isEmpty == false {
                metadata["backendCode"] = code
            }
            return metadata
        }
    }

    if let diagnosticError = error as? AIChatFailureDiagnosticProviding {
        var metadata: [String: String] = [
            "failureKind": diagnosticError is AIChatLiveStreamSetupError
                ? "local_contract_failure"
                : "invalid_sse_payload",
            "stage": diagnosticError.diagnostics.stage.rawValue,
            "errorKind": diagnosticError.diagnostics.errorKind.rawValue,
        ]
        if let statusCode = diagnosticError.diagnostics.statusCode {
            metadata["statusCode"] = String(statusCode)
        }
        if let backendRequestId = diagnosticError.diagnostics.backendRequestId,
           backendRequestId.isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
        if let continuationAttempt = diagnosticError.diagnostics.continuationAttempt {
            metadata["resumeAttempt"] = String(continuationAttempt)
        }
        return metadata
    }

    let nsError = error as NSError
    return [
        "failureKind": "transport_failure",
        "errorDomain": nsError.domain,
        "errorCode": String(nsError.code),
    ]
}
