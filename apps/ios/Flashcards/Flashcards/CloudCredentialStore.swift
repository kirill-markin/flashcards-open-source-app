import Foundation
import Security

enum CloudCredentialStoreError: LocalizedError {
    case encodingFailed
    case decodingFailed
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Cloud credentials could not be encoded for secure storage"
        case .decodingFailed:
            return "Cloud credentials stored in Keychain are invalid"
        case .unexpectedStatus(let status, let operation):
            return "Keychain \(operation) failed with status \(status)"
        }
    }
}

final class CloudCredentialStore {
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let service: String
    private let account: String

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        service: String = (Bundle.main.bundleIdentifier ?? "flashcards-open-source-app") + ".cloud-auth",
        account: String = "primary"
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.service = service
        self.account = account
    }

    func loadCredentials() throws -> StoredCloudCredentials? {
        var result: CFTypeRef?
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: self.account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]

        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw CloudCredentialStoreError.unexpectedStatus(status, "load")
        }

        guard let data = result as? Data else {
            throw CloudCredentialStoreError.decodingFailed
        }

        do {
            return try self.decoder.decode(StoredCloudCredentials.self, from: data)
        } catch {
            throw CloudCredentialStoreError.decodingFailed
        }
    }

    func saveCredentials(credentials: StoredCloudCredentials) throws {
        let data: Data
        do {
            data = try self.encoder.encode(credentials)
        } catch {
            throw CloudCredentialStoreError.encodingFailed
        }

        let baseQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: self.account,
        ]
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemAdd((baseQuery.merging(attributes, uniquingKeysWith: { _, right in right })) as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw CloudCredentialStoreError.unexpectedStatus(updateStatus, "update")
            }
            return
        }

        guard status == errSecSuccess else {
            throw CloudCredentialStoreError.unexpectedStatus(status, "save")
        }
    }

    func clearCredentials() throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: self.account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }

        throw CloudCredentialStoreError.unexpectedStatus(status, "delete")
    }
}
