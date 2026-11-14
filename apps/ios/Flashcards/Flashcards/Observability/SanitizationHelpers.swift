import Foundation
import Sentry

let filteredDiagnosticValue: String = "[Filtered]"

private let ciSimulatorEnvironment: String = "ci-simulator"

private let diagnosticEmbeddedURLExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"https?://[^\s\)\]\}"]+"#,
            options: [.caseInsensitive]
        )
    } catch {
        fatalError("Invalid diagnostic embedded URL regex")
    }
}()
// An OpenAI secret key always starts with "sk-", including the user-supplied key the app forwards.
private let diagnosticOpenAIKeyExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(pattern: #"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}"#)
    } catch {
        fatalError("Invalid diagnostic OpenAI key regex")
    }
}()
// A JWT header is base64url of a JSON object, so a real token always starts with "eyJ".
// Requiring that prefix keeps hostnames, version strings and dotted type names readable.
private let diagnosticJWTExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"#
        )
    } catch {
        fatalError("Invalid diagnostic JWT regex")
    }
}()

func safeDiagnosticIdentifier(_ value: String) -> String {
    let trimmedValue: String = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue.count <= 160 else {
        return filteredDiagnosticValue
    }

    // Swift type and error descriptions are code-authored and routinely contain spaces,
    // parentheses, angle brackets and commas, so keep them and leave secret removal to
    // the sensitive-string pass below.
    let allowedCharacters: CharacterSet = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:- ()<>,"
    )
    guard trimmedValue.rangeOfCharacter(from: allowedCharacters.inverted) == nil else {
        return filteredDiagnosticValue
    }
    guard redactedString(trimmedValue) == trimmedValue else {
        return filteredDiagnosticValue
    }
    return trimmedValue
}

func sanitizeSentryEvent(_ event: Event) -> Event? {
    // Drop App Hang events from CI simulator smoke runs: these are debug-build
    // automation hangs, not real user-facing issues, so they must not create issues.
    if event.environment == ciSimulatorEnvironment,
       event.exceptions?.contains(where: { $0.mechanism?.type == "AppHang" }) == true {
        return nil
    }
    if let request = event.request {
        request.headers = sanitizedHeaders(request.headers)
        request.cookies = nil
        request.url = request.url.map(redactedURLString)
        request.fragment = request.fragment.map(redactedQueryString)
        request.queryString = request.queryString.map(redactedQueryString)
    }
    event.extra = sanitizedDictionary(event.extra)
    event.context = sanitizedContextDictionary(event.context)
    event.tags = sanitizedStringDictionary(event.tags)
    event.breadcrumbs = sanitizedBreadcrumbs(event.breadcrumbs)
    if let exceptions: [Exception] = event.exceptions {
        for exception in exceptions {
            exception.value = exception.value.map(redactedString)
            exception.type = exception.type.map { type in
                sanitizedExceptionType(type, mechanism: exception.mechanism)
            }
            if let mechanism: Mechanism = exception.mechanism {
                mechanism.desc = mechanism.desc.map(redactedString)
                mechanism.data = sanitizedDictionary(mechanism.data)
            }
        }
    }
    return event
}

private func sanitizedExceptionType(_ value: String, mechanism: Mechanism?) -> String {
    guard mechanism?.type == "AppHang" else {
        return safeDiagnosticIdentifier(value)
    }

    return redactedString(value)
}

func sanitizeSentrySpan(_ span: any Span) -> (any Span)? {
    span.operation = redactedSpanText(span.operation)
    span.spanDescription = span.spanDescription.map(redactedSpanText)
    for (key, value) in span.data {
        span.setData(value: sanitizedSpanDataValue(value, key: key), key: key)
    }
    return span
}

private func sanitizedSpanDataValue(_ value: Any, key: String) -> Any {
    let keyPolicy = diagnosticKeyPolicyCache.policy(for: key)
    if keyPolicy.isSensitive {
        return filteredDiagnosticValue
    }
    if keyPolicy.isURLQuery, let queryString = value as? String {
        return redactedQueryString(queryString)
    }
    if keyPolicy.normalized.contains("url"), let urlString = value as? String {
        return redactedURLString(urlString)
    }
    return sanitizedValue(value)
}

private func sanitizedBreadcrumbs(_ breadcrumbs: [Breadcrumb]?) -> [Breadcrumb]? {
    guard let breadcrumbs else {
        return nil
    }

    return breadcrumbs.compactMap(sanitizeSentryBreadcrumb)
}

func sanitizeSentryBreadcrumb(_ breadcrumb: Breadcrumb) -> Breadcrumb? {
    breadcrumb.category = redactedString(breadcrumb.category)
    breadcrumb.type = breadcrumb.type.map(redactedString)
    breadcrumb.message = breadcrumb.message.map(redactedString)
    breadcrumb.origin = breadcrumb.origin.map(redactedString)
    setSentryBreadcrumbData(sanitizedBreadcrumbData(breadcrumb.data) ?? [:], on: breadcrumb)
    return breadcrumb
}

func setSentryBreadcrumbData(_ data: [String: Any], on breadcrumb: Breadcrumb) {
    for (key, value) in data {
        breadcrumb.setData(value: value, key: key)
    }
}

private func sanitizedBreadcrumbData(_ dictionary: [String: Any]?) -> [String: Any]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: Any] = [:]
    for (key, value) in dictionary {
        let keyPolicy = diagnosticKeyPolicyCache.policy(for: key)
        if keyPolicy.isSensitive {
            sanitized[key] = "[Filtered]"
        } else if keyPolicy.isURLQuery, let queryString = value as? String {
            sanitized[key] = redactedQueryString(queryString)
        } else if keyPolicy.normalized == "url", let urlString = value as? String {
            sanitized[key] = redactedURLString(urlString)
        } else {
            sanitized[key] = sanitizedValue(value)
        }
    }
    return sanitized
}

private func sanitizedHeaders(_ headers: [String: String]?) -> [String: String]? {
    guard let headers else {
        return nil
    }

    var sanitizedHeaders: [String: String] = [:]
    for (key, value) in headers {
        if isSensitiveKey(key) {
            sanitizedHeaders[key] = "[Filtered]"
        } else {
            sanitizedHeaders[key] = redactedString(value)
        }
    }
    return sanitizedHeaders
}

private func sanitizedContextDictionary(_ dictionary: [String: [String: Any]]?) -> [String: [String: Any]]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: [String: Any]] = [:]
    for (key, value) in dictionary {
        sanitized[key] = sanitizedDictionary(value) ?? [:]
    }
    return sanitized
}

func sanitizedDictionary(_ dictionary: [String: Any]?) -> [String: Any]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: Any] = [:]
    for (key, value) in dictionary {
        let keyPolicy = diagnosticKeyPolicyCache.policy(for: key)
        if keyPolicy.isSensitive {
            sanitized[key] = "[Filtered]"
        } else if keyPolicy.isURLQuery, let queryString = value as? String {
            sanitized[key] = redactedQueryString(queryString)
        } else if keyPolicy.normalized == "url", let urlString = value as? String {
            sanitized[key] = redactedURLString(urlString)
        } else {
            sanitized[key] = sanitizedValue(value)
        }
    }
    return sanitized
}

func sanitizedStringDictionary(_ dictionary: [String: String]?) -> [String: String]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: String] = [:]
    for (key, value) in dictionary {
        let keyPolicy = diagnosticKeyPolicyCache.policy(for: key)
        if keyPolicy.isSensitive {
            sanitized[key] = "[Filtered]"
        } else if keyPolicy.isURLQuery {
            sanitized[key] = redactedQueryString(value)
        } else if keyPolicy.normalized == "url" {
            sanitized[key] = redactedURLString(value)
        } else {
            sanitized[key] = redactedString(value)
        }
    }
    return sanitized
}

private func sanitizedValue(_ value: Any) -> Any {
    if let stringValue = value as? String {
        return redactedString(stringValue)
    }
    if let dictionaryValue = value as? [String: Any] {
        return sanitizedDictionary(dictionaryValue) ?? [:]
    }
    if let stringDictionaryValue = value as? [String: String] {
        return sanitizedStringDictionary(stringDictionaryValue) ?? [:]
    }
    if let arrayValue = value as? [Any] {
        return arrayValue.map(sanitizedValue)
    }
    return value
}

private struct DiagnosticKeyPolicy: Sendable {
    let normalized: String
    let isSensitive: Bool
    let isURLQuery: Bool
}

private let diagnosticSensitiveKeyFragments = [
    "authorization", "cookie", "csrftoken", "refreshtoken", "idtoken",
    "otpsessiontoken", "otpcode", "token", "password", "secret", "apikey", "signature"
]
private let diagnosticQueryComponentKeys: Set<String> = [
    "query", "querystring", "httpquery", "urlquery", "fragment", "httpfragment", "urlfragment"
]

private let diagnosticKeyPolicyCache = DiagnosticKeyPolicyCache()

/// Only key classification is cached. Every value still passes through the existing secret redactors.
private final class DiagnosticKeyPolicyCache: @unchecked Sendable {
    private let lock = NSLock()
    private var policies: [String: DiagnosticKeyPolicy] = [:]

    func policy(for key: String) -> DiagnosticKeyPolicy {
        // Bound both entry count and key size, including for arbitrary server/user dictionary keys.
        guard key.utf8.count <= 128 else { return Self.makePolicy(for: key) }
        self.lock.lock()
        if let policy = self.policies[key] {
            self.lock.unlock()
            return policy
        }
        self.lock.unlock()

        let policy = Self.makePolicy(for: key)
        self.lock.lock()
        defer { self.lock.unlock() }
        if let existing = self.policies[key] { return existing }
        if self.policies.count >= 512 { self.policies.removeAll(keepingCapacity: true) }
        self.policies[key] = policy
        return policy
    }

    private static func makePolicy(for key: String) -> DiagnosticKeyPolicy {
        let normalized = key
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: ".", with: "")
            .lowercased()
        return DiagnosticKeyPolicy(
            normalized: normalized,
            isSensitive: diagnosticSensitiveKeyFragments.contains { normalized.contains($0) },
            isURLQuery: diagnosticQueryComponentKeys.contains(normalized)
                || normalized.hasSuffix("query")
                || normalized.hasSuffix("querystring")
                || normalized.hasSuffix("fragment")
        )
    }
}

func isSensitiveKey(_ key: String) -> Bool {
    diagnosticKeyPolicyCache.policy(for: key).isSensitive
}

private func redactedURLString(_ value: String) -> String {
    redactedSensitiveString(redactedURLQueryAndFragment(value))
}

private func redactedURLQueryAndFragment(_ value: String) -> String {
    let fragmentParts: [Substring] = value.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
    let queryParts: [Substring] = fragmentParts[0].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    var redactedValue: String = String(queryParts[0])
    if queryParts.count == 2 {
        redactedValue += "?" + redactedQueryString(String(queryParts[1]))
    }
    if fragmentParts.count == 2 {
        redactedValue += "#" + redactedQueryString(String(fragmentParts[1]))
    }
    return redactedValue
}

// Fragments are parsed like queries because OAuth-style fragments carry `access_token=...` pairs.
private func redactedQueryString(_ query: String) -> String {
    let redactedPairs: String = query
        .split(separator: "&", omittingEmptySubsequences: false)
        .map { pair -> String in
            let parts: [Substring] = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let name: String = String(parts[0])
            guard parts.count == 2, isSensitiveKey(name.removingPercentEncoding ?? name) else {
                return String(pair)
            }
            return "\(name)=\(filteredDiagnosticValue)"
        }
        .joined(separator: "&")
    return redactedSensitiveString(redactedPairs)
}

private func redactedString(_ value: String) -> String {
    guard value.isEmpty == false else {
        return value
    }

    return redactedSensitiveString(redactedEmbeddedURLStrings(value))
}

private func redactedSpanText(_ value: String) -> String {
    let urlRedactedValue: String = redactedString(value)
    let parts: [Substring] = urlRedactedValue.split(
        separator: " ",
        omittingEmptySubsequences: false
    )
    return parts
        .map { part -> String in
            let partValue: String = String(part)
            guard partValue.contains("?") || partValue.contains("#") else {
                return partValue
            }
            return redactedURLString(partValue)
        }
        .joined(separator: " ")
}

private func redactedEmbeddedURLStrings(_ value: String) -> String {
    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let matches: [NSTextCheckingResult] = diagnosticEmbeddedURLExpression.matches(
        in: value,
        options: [],
        range: fullRange
    )
    var redactedValue: String = value
    for match in matches.reversed() {
        guard let range: Range<String.Index> = Range(match.range, in: redactedValue) else {
            continue
        }
        let matchedURL: String = String(redactedValue[range])
        redactedValue.replaceSubrange(range, with: redactedURLQueryAndFragment(matchedURL))
    }
    return redactedValue
}

private func redactedSensitiveString(_ value: String) -> String {
    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let keyRedacted: String = diagnosticOpenAIKeyExpression.stringByReplacingMatches(
        in: value,
        options: [],
        range: fullRange,
        withTemplate: "[Filtered key]"
    )

    let jwtRange: NSRange = NSRange(keyRedacted.startIndex..<keyRedacted.endIndex, in: keyRedacted)
    return diagnosticJWTExpression.stringByReplacingMatches(
        in: keyRedacted,
        options: [],
        range: jwtRange,
        withTemplate: "[Filtered token]"
    )
}

func stringifyContext(_ context: [String: Any]) -> [String: String] {
    var fields: [String: String] = [:]
    for (key, value) in context {
        fields[key] = String(describing: value)
    }
    return fields
}

func sanitizedObservationLogValue(_ value: String?) -> String {
    guard let value, value.isEmpty == false else {
        return "-"
    }

    return redactedString(value)
}
