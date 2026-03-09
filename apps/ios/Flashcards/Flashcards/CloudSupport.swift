import Foundation

enum CloudConfigurationError: LocalizedError, Equatable {
    case missingValue(String)
    case invalidUrl(String, String)

    var errorDescription: String? {
        switch self {
        case .missingValue(let key):
            return "Cloud configuration is missing \(key)"
        case .invalidUrl(let key, let value):
            return "Cloud configuration \(key) is invalid: \(value)"
        }
    }
}

func loadCloudServiceConfiguration(bundle: Bundle = .main) throws -> CloudServiceConfiguration {
    let apiBaseUrl = try loadCloudUrlString(bundle: bundle, key: "FLASHCARDS_API_BASE_URL")
    let authBaseUrl = try loadCloudUrlString(bundle: bundle, key: "FLASHCARDS_AUTH_BASE_URL")

    return CloudServiceConfiguration(
        apiBaseUrl: apiBaseUrl,
        authBaseUrl: authBaseUrl
    )
}

func makeIdTokenExpiryTimestamp(now: Date, expiresInSeconds: Int) -> String {
    let expirationDate = now.addingTimeInterval(TimeInterval(expiresInSeconds))
    return isoTimestamp(date: expirationDate)
}

func shouldRefreshCloudIdToken(idTokenExpiresAt: String, now: Date) -> Bool {
    guard let expirationDate = parseIsoTimestamp(value: idTokenExpiresAt) else {
        return true
    }

    return expirationDate.timeIntervalSince(now) <= 300
}

private func loadCloudUrlString(bundle: Bundle, key: String) throws -> String {
    guard let rawValue = bundle.object(forInfoDictionaryKey: key) as? String else {
        throw CloudConfigurationError.missingValue(key)
    }

    let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        throw CloudConfigurationError.missingValue(key)
    }

    let normalizedValue = trimmedValue.hasSuffix("/") ? String(trimmedValue.dropLast()) : trimmedValue
    guard URL(string: normalizedValue) != nil else {
        throw CloudConfigurationError.invalidUrl(key, rawValue)
    }

    return normalizedValue
}
