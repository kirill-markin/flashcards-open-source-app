import Foundation
import Sentry

let filteredDiagnosticValue: String = "[Filtered]"

private let ciSimulatorEnvironment: String = "ci-simulator"

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
    let normalizedKey: String = normalizedDiagnosticKey(key)
    if isSensitiveKey(key) {
        return filteredDiagnosticValue
    }
    if isURLQueryComponentKey(key), let queryString = value as? String {
        return redactedQueryString(queryString)
    }
    if normalizedKey.contains("url"), let urlString = value as? String {
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
        let normalizedKey: String = normalizedDiagnosticKey(key)
        if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else if isURLQueryComponentKey(key), let queryString = value as? String {
            sanitized[key] = redactedQueryString(queryString)
        } else if normalizedKey == "url", let urlString = value as? String {
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
        let normalizedKey: String = normalizedDiagnosticKey(key)
        if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else if isURLQueryComponentKey(key), let queryString = value as? String {
            sanitized[key] = redactedQueryString(queryString)
        } else if normalizedKey == "url", let urlString = value as? String {
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
        let normalizedKey: String = normalizedDiagnosticKey(key)
        if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else if isURLQueryComponentKey(key) {
            sanitized[key] = redactedQueryString(value)
        } else if normalizedKey == "url" {
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

func isSensitiveKey(_ key: String) -> Bool {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let sensitiveFragments: [String] = [
        "authorization",
        "cookie",
        "csrftoken",
        "refreshtoken",
        "idtoken",
        "otpsessiontoken",
        "otpcode",
        "token",
        "password",
        "secret",
        "apikey",
        "signature"
    ]
    return sensitiveFragments.contains { fragment in
        normalizedKey.contains(fragment)
    }
}

private func isURLQueryComponentKey(_ key: String) -> Bool {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let queryComponentKeys: Set<String> = [
        "query",
        "querystring",
        "httpquery",
        "urlquery",
        "fragment",
        "httpfragment",
        "urlfragment"
    ]
    if queryComponentKeys.contains(normalizedKey) {
        return true
    }

    return normalizedKey.hasSuffix("query") ||
        normalizedKey.hasSuffix("querystring") ||
        normalizedKey.hasSuffix("fragment")
}

private func normalizedDiagnosticKey(_ key: String) -> String {
    key
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: ".", with: "")
        .lowercased()
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
    let urlPattern: String = #"https?://[^\s\)\]\}"]+"#
    guard let urlRegex: NSRegularExpression = try? NSRegularExpression(
        pattern: urlPattern,
        options: [.caseInsensitive]
    ) else {
        return value
    }

    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let matches: [NSTextCheckingResult] = urlRegex.matches(
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
    // An OpenAI secret key always starts with "sk-", including the user-supplied key the app forwards.
    let openAIKeyPattern: String = #"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}"#
    let openAIKeyRegex: NSRegularExpression? = try? NSRegularExpression(pattern: openAIKeyPattern)
    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let keyRedacted: String = openAIKeyRegex?.stringByReplacingMatches(
        in: value,
        options: [],
        range: fullRange,
        withTemplate: "[Filtered key]"
    ) ?? value

    // A JWT header is base64url of a JSON object, so a real token always starts with "eyJ".
    // Requiring that prefix keeps hostnames, version strings and dotted type names readable.
    let jwtPattern: String = #"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"#
    let jwtRegex: NSRegularExpression? = try? NSRegularExpression(pattern: jwtPattern)
    let jwtRange: NSRange = NSRange(keyRedacted.startIndex..<keyRedacted.endIndex, in: keyRedacted)
    return jwtRegex?.stringByReplacingMatches(
        in: keyRedacted,
        options: [],
        range: jwtRange,
        withTemplate: "[Filtered token]"
    ) ?? keyRedacted
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
