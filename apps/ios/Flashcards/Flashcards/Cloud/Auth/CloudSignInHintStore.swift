import Foundation
import Security

enum CloudSignInHintStoreError: LocalizedError {
    case invalidStoredHint
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .invalidStoredHint:
            return "The remembered sign-in hint in Keychain is invalid. Sign in again to replace it."
        case .unexpectedStatus(let status, let operation):
            return "Keychain could not \(operation) (status \(status))."
        }
    }
}

final class CloudSignInHintStore {
    private let service: String

    init(service: String) {
        self.service = service
    }

    private var query: [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: self.service, kSecAttrAccount: "last-successful"]
    }

    func load() throws -> CloudSuccessfulSignInHint? {
        let query: [CFString: Any] = self.query.merging([
            kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne,
        ]) { _, right in right }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CloudSignInHintStoreError.unexpectedStatus(status, "load sign-in hint") }
        guard let data = result as? Data else { throw CloudSignInHintStoreError.invalidStoredHint }
        do {
            return try JSONDecoder().decode(CloudSuccessfulSignInHint.self, from: data)
        } catch {
            throw CloudSignInHintStoreError.invalidStoredHint
        }
    }

    func save(_ hint: CloudSuccessfulSignInHint) throws {
        let attributes: [CFString: Any] = [
            kSecValueData: try JSONEncoder().encode(hint),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(self.query.merging(attributes) { _, right in right } as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(self.query as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw CloudSignInHintStoreError.unexpectedStatus(updateStatus, "update sign-in hint")
            }
            return
        }
        guard status == errSecSuccess else { throw CloudSignInHintStoreError.unexpectedStatus(status, "save sign-in hint") }
    }

    func clear() throws {
        let status = SecItemDelete(self.query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CloudSignInHintStoreError.unexpectedStatus(status, "delete sign-in hint")
        }
    }
}
