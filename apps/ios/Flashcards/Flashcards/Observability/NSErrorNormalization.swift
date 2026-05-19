import Foundation

private let sanitizedNSErrorFallbackDomain: String = "FlashcardsObservabilitySanitizedError"

func sanitizedNSError(_ error: Error, action: String) -> NSError {
    let nsError: NSError = error as NSError
    let errorType: String = safeDiagnosticIdentifier(String(reflecting: type(of: error)))
    let originalDomain: String = safeDiagnosticIdentifier(nsError.domain)
    let userInfo: [String: Any] = [
        NSLocalizedDescriptionKey: "Sanitized iOS exception: \(safeDiagnosticIdentifier(action))",
        "flashcards_original_error_type": errorType,
        "flashcards_original_error_domain": originalDomain,
        "flashcards_original_error_code": String(nsError.code),
        "flashcards_original_user_info_key_count": String(nsError.userInfo.count),
        "flashcards_safe_user_info_keys": safeNSErrorUserInfoKeys(nsError.userInfo).joined(separator: ",")
    ]

    return NSError(
        domain: sanitizedNSErrorDomain(errorType: errorType, originalDomain: originalDomain),
        code: nsError.code,
        userInfo: userInfo
    )
}

private func sanitizedNSErrorDomain(errorType: String, originalDomain: String) -> String {
    if errorType != filteredDiagnosticValue, errorType != "Foundation.NSError", errorType != "NSError" {
        return errorType
    }
    if originalDomain != filteredDiagnosticValue {
        return originalDomain
    }
    return sanitizedNSErrorFallbackDomain
}

private func safeNSErrorUserInfoKeys(_ userInfo: [String: Any]) -> [String] {
    let sortedKeys: [String] = userInfo.keys.sorted()
    return sortedKeys.compactMap { key in
        guard isSensitiveKey(key) == false else {
            return nil
        }
        let safeKey: String = safeDiagnosticIdentifier(key)
        guard safeKey != filteredDiagnosticValue else {
            return nil
        }
        return safeKey
    }
}
