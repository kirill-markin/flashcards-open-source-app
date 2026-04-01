import Foundation

struct FlashcardsLegalSupportConfiguration: Equatable {
    let privacyPolicyUrl: String
    let termsOfServiceUrl: String
    let supportUrl: String
    let supportEmailAddress: String
}

enum CloudConfigurationError: LocalizedError, Equatable {
    case missingValue(String)
    case invalidUrl(String, String)
    case invalidCustomOrigin(String)

    var errorDescription: String? {
        switch self {
        case .missingValue(let key):
            return "Cloud configuration is missing \(key)"
        case .invalidUrl(let key, let value):
            return "Cloud configuration \(key) is invalid: \(value)"
        case .invalidCustomOrigin(let value):
            return "Custom server must be a base HTTPS URL like https://example.com. Received: \(value)"
        }
    }
}

let customCloudServerOverrideUserDefaultsKey: String = "custom-cloud-server-override"
let pendingCloudServerBootstrapUserDefaultsKey: String = "pending-cloud-server-bootstrap"
let flashcardsRepositoryUrl: String = "https://github.com/kirill-markin/flashcards-open-source-app"

var flashcardsPrivacyPolicyUrl: String {
    flashcardsLegalSupportConfiguration.privacyPolicyUrl
}

var flashcardsTermsOfServiceUrl: String {
    flashcardsLegalSupportConfiguration.termsOfServiceUrl
}

var flashcardsSupportUrl: String {
    flashcardsLegalSupportConfiguration.supportUrl
}

var flashcardsSupportEmailAddress: String {
    flashcardsLegalSupportConfiguration.supportEmailAddress
}

var flashcardsSupportEmailUrl: String {
    "mailto:\(flashcardsSupportEmailAddress)"
}

func loadCloudServiceConfiguration(
    bundle: Bundle = .main,
    userDefaults: UserDefaults = .standard,
    decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()
) throws -> CloudServiceConfiguration {
    if let override = try loadCloudServerOverride(userDefaults: userDefaults, decoder: decoder) {
        return try makeCustomCloudServiceConfiguration(customOrigin: override.customOrigin)
    }

    return try loadOfficialCloudServiceConfiguration(bundle: bundle)
}

func loadFlashcardsLegalSupportConfiguration(bundle: Bundle) throws -> FlashcardsLegalSupportConfiguration {
    FlashcardsLegalSupportConfiguration(
        privacyPolicyUrl: try loadCloudPageUrlString(
            bundle: bundle,
            key: "FLASHCARDS_PRIVACY_POLICY_URL"
        ),
        termsOfServiceUrl: try loadCloudPageUrlString(
            bundle: bundle,
            key: "FLASHCARDS_TERMS_OF_SERVICE_URL"
        ),
        supportUrl: try loadCloudPageUrlString(
            bundle: bundle,
            key: "FLASHCARDS_SUPPORT_URL"
        ),
        supportEmailAddress: try loadCloudString(
            bundle: bundle,
            key: "FLASHCARDS_SUPPORT_EMAIL_ADDRESS"
        )
    )
}

func loadCloudServerOverride(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) throws -> CloudServerOverride? {
    guard let storedData = userDefaults.data(forKey: customCloudServerOverrideUserDefaultsKey) else {
        return nil
    }

    do {
        return try decoder.decode(CloudServerOverride.self, from: storedData)
    } catch {
        throw LocalStoreError.validation(
            "Stored custom server override is invalid: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func saveCloudServerOverride(
    override: CloudServerOverride,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) throws {
    do {
        let storedData = try encoder.encode(override)
        userDefaults.set(storedData, forKey: customCloudServerOverrideUserDefaultsKey)
    } catch {
        throw LocalStoreError.validation(
            "Custom server override could not be saved: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func clearCloudServerOverride(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: customCloudServerOverrideUserDefaultsKey)
}

func makeCustomCloudServiceConfiguration(customOrigin: String) throws -> CloudServiceConfiguration {
    let normalizedOrigin = try normalizeCustomCloudOrigin(customOrigin)
    let baseUrl = URLComponents(string: normalizedOrigin)
        .flatMap { components -> URLComponents? in
            guard components.host != nil else {
                return nil
            }

            return components
        }
    guard let baseUrl else {
        throw CloudConfigurationError.invalidCustomOrigin(customOrigin)
    }

    let apiBaseUrl = try deriveSubdomainUrlString(
        components: baseUrl,
        subdomainPrefix: "api",
        suffixPath: "/v1",
        inputValue: customOrigin
    )
    let authBaseUrl = try deriveSubdomainUrlString(
        components: baseUrl,
        subdomainPrefix: "auth",
        suffixPath: "",
        inputValue: customOrigin
    )

    return CloudServiceConfiguration(
        mode: .custom,
        customOrigin: normalizedOrigin,
        apiBaseUrl: apiBaseUrl,
        authBaseUrl: authBaseUrl
    )
}

func makeIdTokenExpiryTimestamp(now: Date, expiresInSeconds: Int) -> String {
    let expirationDate = now.addingTimeInterval(TimeInterval(expiresInSeconds))
    return formatIsoTimestamp(date: expirationDate)
}

func shouldRefreshCloudIdToken(idTokenExpiresAt: String, now: Date) -> Bool {
    guard let expirationDate = parseIsoTimestamp(value: idTokenExpiresAt) else {
        return true
    }

    return expirationDate.timeIntervalSince(now) <= 300
}

private var flashcardsLegalSupportConfiguration: FlashcardsLegalSupportConfiguration {
    loadRequiredFlashcardsLegalSupportConfiguration(bundle: .main)
}

private func loadRequiredFlashcardsLegalSupportConfiguration(
    bundle: Bundle
) -> FlashcardsLegalSupportConfiguration {
    do {
        return try loadFlashcardsLegalSupportConfiguration(bundle: bundle)
    } catch {
        fatalError("Flashcards legal/support configuration is invalid: \(Flashcards.errorMessage(error: error))")
    }
}

private func loadCloudString(bundle: Bundle, key: String) throws -> String {
    guard let rawValue = bundle.object(forInfoDictionaryKey: key) as? String else {
        throw CloudConfigurationError.missingValue(key)
    }

    let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        throw CloudConfigurationError.missingValue(key)
    }

    return trimmedValue
}

private func loadCloudUrlString(bundle: Bundle, key: String) throws -> String {
    let rawValue = try loadCloudString(bundle: bundle, key: key)
    let normalizedValue = rawValue.hasSuffix("/") ? String(rawValue.dropLast()) : rawValue
    guard isValidAbsoluteCloudUrlString(normalizedValue) else {
        throw CloudConfigurationError.invalidUrl(key, rawValue)
    }

    return normalizedValue
}

private func loadCloudPageUrlString(bundle: Bundle, key: String) throws -> String {
    let rawValue = try loadCloudString(bundle: bundle, key: key)
    guard isValidAbsoluteCloudUrlString(rawValue) else {
        throw CloudConfigurationError.invalidUrl(key, rawValue)
    }

    return rawValue
}

private func isValidAbsoluteCloudUrlString(_ value: String) -> Bool {
    guard let components = URLComponents(string: value) else {
        return false
    }
    guard let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
        return false
    }

    return components.host?.isEmpty == false
}

private func loadOfficialCloudServiceConfiguration(bundle: Bundle) throws -> CloudServiceConfiguration {
    let apiBaseUrl = try loadCloudUrlString(bundle: bundle, key: "FLASHCARDS_API_BASE_URL")
    let authBaseUrl = try loadCloudUrlString(bundle: bundle, key: "FLASHCARDS_AUTH_BASE_URL")

    return CloudServiceConfiguration(
        mode: .official,
        customOrigin: nil,
        apiBaseUrl: apiBaseUrl,
        authBaseUrl: authBaseUrl
    )
}

private func normalizeCustomCloudOrigin(_ value: String) throws -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }

    guard let parsedUrl = URL(string: trimmedValue), var components = URLComponents(url: parsedUrl, resolvingAgainstBaseURL: false) else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }
    guard components.scheme?.lowercased() == "https" else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }
    guard let host = components.host?.trimmingCharacters(in: .whitespacesAndNewlines), host.isEmpty == false else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }
    guard components.user == nil, components.password == nil else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }
    guard components.query == nil, components.fragment == nil else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }
    guard components.path.isEmpty || components.path == "/" else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }

    components.scheme = "https"
    components.host = host.lowercased()
    components.path = ""
    components.query = nil
    components.fragment = nil

    guard let normalizedValue = components.string else {
        throw CloudConfigurationError.invalidCustomOrigin(value)
    }

    return normalizedValue
}

private func deriveSubdomainUrlString(
    components: URLComponents,
    subdomainPrefix: String,
    suffixPath: String,
    inputValue: String
) throws -> String {
    var derivedComponents = components
    guard let host = components.host else {
        throw CloudConfigurationError.invalidCustomOrigin(inputValue)
    }

    derivedComponents.host = "\(subdomainPrefix).\(host)"
    derivedComponents.path = suffixPath

    guard let urlString = derivedComponents.string, URL(string: urlString) != nil else {
        throw CloudConfigurationError.invalidCustomOrigin(inputValue)
    }

    return urlString
}
