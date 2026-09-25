import Foundation
import Security

let ownOpenAIKeyRequestHeaderName: String = "x-openai-api-key"
private let ownOpenAIKeyEnabledUserDefaultsKey: String = "own-openai-key-enabled"
private let ownOpenAIKeyErrorCodes: Set<String> = [
    "OPENAI_API_KEY_INVALID",
    "OWN_OPENAI_KEY_PROVIDER_ERROR",
]

func loadOwnOpenAIKeyEnabled(userDefaults: UserDefaults) -> Bool {
    userDefaults.bool(forKey: ownOpenAIKeyEnabledUserDefaultsKey)
}

func persistOwnOpenAIKeyEnabled(userDefaults: UserDefaults, isEnabled: Bool) {
    userDefaults.set(isEnabled, forKey: ownOpenAIKeyEnabledUserDefaultsKey)
}

enum OwnOpenAIKeyStoreError: LocalizedError {
    case decodingFailed
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .decodingFailed:
            return "The OpenAI key stored in Keychain is not valid text"
        case .unexpectedStatus(let status, let operation):
            return "Keychain \(operation) of the OpenAI key failed with status \(status)"
        }
    }
}

/**
 The person's own OpenAI key. The switch lives in UserDefaults and the key in this device's Keychain, so
 turning the switch off keeps the key for the next time it is turned on. The key leaves the device only
 as the `x-openai-api-key` header on `POST /chat` and `POST /chat/transcriptions`.
 */
final class OwnOpenAIKeyStore: @unchecked Sendable {
    private let userDefaults: UserDefaults
    private let keychainService: String
    private let keychainAccount: String

    init(userDefaults: UserDefaults, keychainService: String, keychainAccount: String) {
        self.userDefaults = userDefaults
        self.keychainService = keychainService
        self.keychainAccount = keychainAccount
    }

    /// The key to send, or nil while the switch is off or no key is entered. The Keychain is read only while the switch is on.
    func loadActiveApiKey() throws -> String? {
        guard loadOwnOpenAIKeyEnabled(userDefaults: self.userDefaults) else {
            return nil
        }

        let apiKey = try self.loadApiKey().trimmingCharacters(in: .whitespacesAndNewlines)
        return apiKey.isEmpty ? nil : apiKey
    }

    func loadApiKey() throws -> String {
        var result: CFTypeRef?
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.keychainService,
            kSecAttrAccount: self.keychainAccount,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]

        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return ""
        }

        guard status == errSecSuccess else {
            throw OwnOpenAIKeyStoreError.unexpectedStatus(status, "load")
        }

        guard let data = result as? Data, let apiKey = String(data: data, encoding: .utf8) else {
            throw OwnOpenAIKeyStoreError.decodingFailed
        }

        return apiKey
    }

    /// An empty key deletes the Keychain item rather than storing an empty value.
    func saveApiKey(apiKey: String) throws {
        let baseQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.keychainService,
            kSecAttrAccount: self.keychainAccount,
        ]

        if apiKey.isEmpty {
            let deleteStatus = SecItemDelete(baseQuery as CFDictionary)
            guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
                throw OwnOpenAIKeyStoreError.unexpectedStatus(deleteStatus, "delete")
            }
            return
        }

        let attributes: [CFString: Any] = [
            kSecValueData: Data(apiKey.utf8),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemAdd((baseQuery.merging(attributes, uniquingKeysWith: { _, right in right })) as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw OwnOpenAIKeyStoreError.unexpectedStatus(updateStatus, "update")
            }
            return
        }

        guard status == errSecSuccess else {
            throw OwnOpenAIKeyStoreError.unexpectedStatus(status, "save")
        }
    }
}

func makeOwnOpenAIKeyStore(userDefaults: UserDefaults) -> OwnOpenAIKeyStore {
    OwnOpenAIKeyStore(
        userDefaults: userDefaults,
        keychainService: appBundleIdentifier() + ".own-openai-key",
        keychainAccount: "primary"
    )
}

/// Adds the key header to a request's headers while the person's own key is active.
func addingOwnOpenAIKeyHeader(headers: [String: String], ownOpenAIKeyStore: OwnOpenAIKeyStore) throws -> [String: String] {
    guard let apiKey = try ownOpenAIKeyStore.loadActiveApiKey() else {
        return headers
    }

    var updatedHeaders = headers
    updatedHeaders[ownOpenAIKeyRequestHeaderName] = apiKey
    return updatedHeaders
}

/// Error codes the backend returns only for a request that carried the person's own key.
func isOwnOpenAIKeyErrorCode(_ code: String?) -> Bool {
    guard let code else {
        return false
    }

    return ownOpenAIKeyErrorCodes.contains(code)
}

/// OpenAI's text stays unchanged below the prefix, because only the person can act on it in their OpenAI account.
func aiChatOwnOpenAIKeyErrorMessage(providerMessage: String) -> String {
    let prefix = aiSettingsLocalized(
        "ai.error.ownOpenAIKey.prefix",
        "Your own OpenAI key is on. OpenAI returned this error for your key. Fix it in your OpenAI account and try again."
    )
    return "\(prefix)\n\n\(providerMessage)"
}
