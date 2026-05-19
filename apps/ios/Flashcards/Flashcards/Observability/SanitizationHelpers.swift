import CryptoKit
import Foundation
import Sentry

let filteredDiagnosticValue: String = "[Filtered]"

func appSpecificObservabilityHash(_ value: String, namespace: String) -> String {
    let hashInput: String = "\(appBundleIdentifier()):observability:\(namespace):\(value)"
    let digest: SHA256.Digest = SHA256.hash(data: Data(hashInput.utf8))
    return digest.map { byte in
        String(format: "%02x", byte)
    }
    .joined()
}

func safeDiagnosticIdentifier(_ value: String) -> String {
    let trimmedValue: String = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue.count <= 160 else {
        return filteredDiagnosticValue
    }

    let allowedCharacters: CharacterSet = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
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
    if let request = event.request {
        request.headers = sanitizedHeaders(request.headers)
        request.cookies = nil
        request.url = request.url.map(redactedURLString)
        request.fragment = nil
        request.queryString = nil
    }
    event.extra = sanitizedDictionary(event.extra)
    event.context = sanitizedContextDictionary(event.context)
    event.tags = sanitizedStringDictionary(event.tags)
    event.breadcrumbs = sanitizedBreadcrumbs(event.breadcrumbs)
    if let exceptions: [Exception] = event.exceptions {
        for exception in exceptions {
            exception.value = exception.value.map(redactedString)
            exception.type = exception.type.map(safeDiagnosticIdentifier)
            if let mechanism: Mechanism = exception.mechanism {
                mechanism.desc = mechanism.desc.map(redactedString)
                mechanism.data = sanitizedDictionary(mechanism.data)
            }
        }
    }
    return event
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
    if stableObservationIdentifierHashKey(key) != nil {
        return hashedObservationIdentifierValue(value, key: key)
    }
    if isSensitiveKey(key) || normalizedKey.contains("query") || normalizedKey.contains("fragment") {
        return filteredDiagnosticValue
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
    breadcrumb.data = sanitizedBreadcrumbData(breadcrumb.data) ?? [:]
    return breadcrumb
}

private func sanitizedBreadcrumbData(_ dictionary: [String: Any]?) -> [String: Any]? {
    guard let dictionary else {
        return nil
    }

    var sanitized: [String: Any] = [:]
    for (key, value) in dictionary {
        let normalizedKey: String = normalizedDiagnosticKey(key)
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifierValue(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
        } else if normalizedKey == "url", let urlString = value as? String {
            sanitized[key] = redactedURLString(urlString)
        } else if normalizedKey == "httpquery" || normalizedKey == "httpfragment" {
            sanitized[key] = "[Filtered]"
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
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifierValue(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
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
        if let hashKey: String = stableObservationIdentifierHashKey(key) {
            sanitized[hashKey] = hashedObservationIdentifier(value, key: key)
        } else if isSensitiveKey(key) {
            sanitized[key] = "[Filtered]"
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

private func stableObservationIdentifierHashKey(_ key: String) -> String? {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let passThroughIdentifierKeys: Set<String> = [
        "requestid",
        "clientrequestid",
        "backendrequestid"
    ]
    guard passThroughIdentifierKeys.contains(normalizedKey) == false else {
        return nil
    }

    if normalizedKey == "userid" ||
        normalizedKey == "cardid" ||
        normalizedKey == "entityid" ||
        normalizedKey == "conversationscopeid" ||
        normalizedKey == "eventconversationscopeid" ||
        normalizedKey == "cursor" ||
        normalizedKey == "aftercursor" ||
        normalizedKey == "eventcursor" ||
        normalizedKey == "livecursor" ||
        normalizedKey == "oldestcursor" ||
        normalizedKey == "streamepoch" ||
        normalizedKey == "eventstreamepoch" ||
        normalizedKey == "activestreamepoch" ||
        normalizedKey == "installationid" ||
        normalizedKey.hasSuffix("sessionid") ||
        normalizedKey.hasSuffix("runid") ||
        normalizedKey.hasSuffix("itemid") ||
        normalizedKey.hasSuffix("messageid") ||
        normalizedKey.hasSuffix("toolcallid") ||
        normalizedKey.hasSuffix("workspaceid") {
        return key.hasSuffix("_hash") ? key : "\(key)_hash"
    }

    return nil
}

private func hashedObservationIdentifierValue(_ value: Any, key: String) -> Any {
    if let stringValue: String = value as? String {
        return hashedObservationIdentifier(stringValue, key: key)
    }
    if let stringArray: [String] = value as? [String] {
        return stringArray.map { item in
            hashedObservationIdentifier(item, key: key)
        }
    }
    return filteredDiagnosticValue
}

func hashedObservationIdentifierLogValue(_ value: String?, key: String) -> String {
    guard let value, value.isEmpty == false else {
        return "-"
    }
    return hashedObservationIdentifier(value, key: key)
}

func hashedObservationIdentifier(_ value: String, key: String) -> String {
    guard value.isEmpty == false else {
        return value
    }
    return appSpecificObservabilityHash(
        value,
        namespace: "observation_\(normalizedDiagnosticKey(key))"
    )
}

func isSensitiveKey(_ key: String) -> Bool {
    let normalizedKey: String = normalizedDiagnosticKey(key)
    let safeDiagnosticKeys: Set<String> = [
        "codingpath",
        "decodersummarylength",
        "eventtype",
        "hasdecodersummary",
        "payloadbytes",
        "payloadlength",
        "rawsnippetlength"
    ]
    if safeDiagnosticKeys.contains(normalizedKey) {
        return false
    }

    let sensitiveFragments: [String] = [
        "authorization",
        "cookie",
        "csrftoken",
        "refreshtoken",
        "idtoken",
        "otpsessiontoken",
        "token",
        "fronttext",
        "backtext",
        "prompt",
        "rawoutput",
        "rawsnippet",
        "payloadsnippet",
        "responsebody",
        "requestbody",
        "body",
        "localizeddescription",
        "debugdescription",
        "decodersummary",
        "underlyingerror",
        "messagesummary",
        "errorsummary",
        "detailsummary",
        "base64data",
        "email"
    ]
    return sensitiveFragments.contains { fragment in
        normalizedKey.contains(fragment)
    }
}

private func normalizedDiagnosticKey(_ key: String) -> String {
    key
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: ".", with: "")
        .lowercased()
}

private func redactedURLString(_ value: String) -> String {
    guard let redactedURL: String = redactedAbsoluteURLString(value) else {
        if let redactedRelativeURL: String = redactedRelativeURLString(value) {
            return redactedSensitiveString(redactedRelativeURL)
        }
        return redactedString(value)
    }

    return redactedSensitiveString(redactedURL)
}

private func redactedAbsoluteURLString(_ value: String) -> String? {
    guard var components = URLComponents(string: value),
          components.scheme != nil,
          components.host != nil else {
        return nil
    }

    components.query = nil
    components.fragment = nil
    components.path = redactedURLPath(components.path)
    return components.string ?? value
}

private func redactedRelativeURLString(_ value: String) -> String? {
    guard var components = URLComponents(string: value),
          components.path.hasPrefix("/") else {
        return nil
    }

    components.query = nil
    components.fragment = nil
    components.path = redactedURLPath(components.path)
    return components.string ?? value
}

private func redactedURLPath(_ path: String) -> String {
    path
        .split(separator: "/", omittingEmptySubsequences: false)
        .map { segment -> String in
            let segmentValue: String = String(segment)
            guard shouldRedactURLPathSegment(segmentValue) else {
                return segmentValue
            }
            return "[Filtered]"
        }
        .joined(separator: "/")
}

private func shouldRedactURLPathSegment(_ segment: String) -> Bool {
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

    return false
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
        let replacement: String = redactedAbsoluteURLString(matchedURL) ?? redactedSensitiveString(matchedURL)
        redactedValue.replaceSubrange(range, with: replacement)
    }
    return redactedValue
}

private func redactedSensitiveString(_ value: String) -> String {
    let emailPattern: String = #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#
    let emailRegex: NSRegularExpression? = try? NSRegularExpression(
        pattern: emailPattern,
        options: [.caseInsensitive]
    )
    let fullRange: NSRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let emailRedacted: String = emailRegex?.stringByReplacingMatches(
        in: value,
        options: [],
        range: fullRange,
        withTemplate: "[Filtered email]"
    ) ?? value

    let jwtPattern: String = #"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#
    let jwtRegex: NSRegularExpression? = try? NSRegularExpression(pattern: jwtPattern)
    let jwtRange: NSRange = NSRange(emailRedacted.startIndex..<emailRedacted.endIndex, in: emailRedacted)
    return jwtRegex?.stringByReplacingMatches(
        in: emailRedacted,
        options: [],
        range: jwtRange,
        withTemplate: "[Filtered token]"
    ) ?? emailRedacted
}

func stringifyContext(_ context: [String: Any]) -> [String: String] {
    var fields: [String: String] = [:]
    for (key, value) in context {
        fields[key] = String(describing: value)
    }
    return fields
}
