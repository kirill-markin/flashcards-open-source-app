import Foundation

struct CloudAuthInlineErrorPresentation: Equatable {
    let message: String
    let technicalDetails: String?
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
    if isCloudAuthTransportFailure(error: error) {
        return CloudAuthInlineErrorPresentation(
            message: makeCloudAuthTransportFailureMessage(context: context),
            technicalDetails: String(describing: error)
        )
    }

    return CloudAuthInlineErrorPresentation(
        message: errorMessage(error: error),
        technicalDetails: nil
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
