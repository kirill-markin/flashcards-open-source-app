import Foundation
import Security

enum GuestCloudCredentialStoreError: LocalizedError {
    case encodingFailed
    case decodingFailed
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Guest AI credentials could not be encoded for secure storage"
        case .decodingFailed:
            return "Guest AI credentials stored in Keychain are invalid"
        case .unexpectedStatus(let status, let operation):
            return "Keychain \(operation) failed with status \(status)"
        }
    }
}

final class GuestCloudCredentialStore {
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let service: String
    private let account: String

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        service: String = (Bundle.main.bundleIdentifier ?? "flashcards-open-source-app") + ".guest-cloud-auth",
        account: String = "primary"
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.service = service
        self.account = account
    }

    private var usesTestFileStorage: Bool {
        self.service.hasPrefix("tests-")
    }

    private var testStorageUrl: URL {
        let fileName = "\(self.service)-\(self.account)-guest-cloud-session.json"
            .replacingOccurrences(of: "/", with: "-")
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName, isDirectory: false)
    }

    func loadGuestSession() throws -> StoredGuestCloudSession? {
        if self.usesTestFileStorage {
            return try self.loadGuestSessionFromTestFile()
        }

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
            throw GuestCloudCredentialStoreError.unexpectedStatus(status, "load")
        }

        guard let data = result as? Data else {
            throw GuestCloudCredentialStoreError.decodingFailed
        }

        do {
            return try self.decoder.decode(StoredGuestCloudSession.self, from: data)
        } catch {
            throw GuestCloudCredentialStoreError.decodingFailed
        }
    }

    func saveGuestSession(session: StoredGuestCloudSession) throws {
        if self.usesTestFileStorage {
            try self.saveGuestSessionToTestFile(session: session)
            return
        }

        let data: Data
        do {
            data = try self.encoder.encode(session)
        } catch {
            throw GuestCloudCredentialStoreError.encodingFailed
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
                throw GuestCloudCredentialStoreError.unexpectedStatus(updateStatus, "update")
            }
            return
        }

        guard status == errSecSuccess else {
            throw GuestCloudCredentialStoreError.unexpectedStatus(status, "save")
        }
    }

    func clearGuestSession() throws {
        if self.usesTestFileStorage {
            try self.clearGuestSessionFromTestFile()
            return
        }

        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: self.account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }

        throw GuestCloudCredentialStoreError.unexpectedStatus(status, "delete")
    }

    private func loadGuestSessionFromTestFile() throws -> StoredGuestCloudSession? {
        let fileUrl = self.testStorageUrl
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return nil
        }

        let data = try Data(contentsOf: fileUrl)
        do {
            return try self.decoder.decode(StoredGuestCloudSession.self, from: data)
        } catch {
            throw GuestCloudCredentialStoreError.decodingFailed
        }
    }

    private func saveGuestSessionToTestFile(session: StoredGuestCloudSession) throws {
        let data: Data
        do {
            data = try self.encoder.encode(session)
        } catch {
            throw GuestCloudCredentialStoreError.encodingFailed
        }

        try data.write(to: self.testStorageUrl, options: .atomic)
    }

    private func clearGuestSessionFromTestFile() throws {
        let fileUrl = self.testStorageUrl
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return
        }

        try FileManager.default.removeItem(at: fileUrl)
    }
}
