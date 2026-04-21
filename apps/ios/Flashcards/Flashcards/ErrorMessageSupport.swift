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
    if error is URLError {
        return true
    }

    return isCloudAuthTransportFailure(nsError: error as NSError)
}

private func isCloudAuthTransportFailure(nsError: NSError) -> Bool {
    if nsError.domain == NSURLErrorDomain {
        return true
    }

    if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
        return isCloudAuthTransportFailure(nsError: underlyingError)
    }

    return false
}
