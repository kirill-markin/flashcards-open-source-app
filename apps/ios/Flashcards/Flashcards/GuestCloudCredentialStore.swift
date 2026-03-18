import Foundation
import Security

private struct LegacyStoredGuestCloudSession: Codable {
    let guestToken: String
    let userId: String
    let workspaceId: String
}

enum GuestCloudCredentialStoreError: LocalizedError {
    case encodingFailed
    case decodingFailed
    case migrationFailed(String)
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Guest AI credentials could not be encoded for secure storage"
        case .decodingFailed:
            return "Guest AI credentials stored in Keychain are invalid"
        case .migrationFailed(let message):
            return "Guest AI credentials could not be migrated: \(message)"
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
    private let bundle: Bundle
    private let userDefaults: UserDefaults

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        service: String = (Bundle.main.bundleIdentifier ?? "flashcards-open-source-app") + ".guest-cloud-auth",
        account: String = "primary",
        bundle: Bundle = .main,
        userDefaults: UserDefaults = .standard
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.service = service
        self.account = account
        self.bundle = bundle
        self.userDefaults = userDefaults
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

        return try self.decodeGuestSession(data: data)
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
        return try self.decodeGuestSession(data: data)
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

    private func decodeGuestSession(data: Data) throws -> StoredGuestCloudSession {
        do {
            return try self.decoder.decode(StoredGuestCloudSession.self, from: data)
        } catch {
            guard let legacySession = try? self.decoder.decode(LegacyStoredGuestCloudSession.self, from: data) else {
                throw GuestCloudCredentialStoreError.decodingFailed
            }

            return try self.migrateLegacyGuestSession(session: legacySession)
        }
    }

    private func migrateLegacyGuestSession(session: LegacyStoredGuestCloudSession) throws -> StoredGuestCloudSession {
        let configuration: CloudServiceConfiguration
        do {
            configuration = try loadCloudServiceConfiguration(
                bundle: self.bundle,
                userDefaults: self.userDefaults,
                decoder: self.decoder
            )
        } catch {
            throw GuestCloudCredentialStoreError.migrationFailed(Flashcards.errorMessage(error: error))
        }

        let migratedSession = StoredGuestCloudSession(
            guestToken: session.guestToken,
            userId: session.userId,
            workspaceId: session.workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )

        do {
            try self.saveGuestSession(session: migratedSession)
        } catch {
            throw GuestCloudCredentialStoreError.migrationFailed(Flashcards.errorMessage(error: error))
        }

        return migratedSession
    }
}
