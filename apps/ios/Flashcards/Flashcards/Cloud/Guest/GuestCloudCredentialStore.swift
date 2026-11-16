import Foundation
import Security

struct LegacyStoredGuestCloudSession: Codable, Sendable {
    let guestToken: String
    let userId: String
    let workspaceId: String
}

/**
 * State that belongs to the guest credential without belonging to the session record: the key an
 * outstanding creation attempt reuses, and the token of a session this install created to
 * authenticate analytics and has not adopted as its cloud session.
 *
 * It lives in its own Keychain item so the session record keeps the shape every stored credential
 * already has, and so it travels with that credential across an app reinstall.
 */
struct StoredGuestCloudSessionSidecar: Codable, Sendable {
    let creationIdempotencyKey: String?
    let analyticsOnlyGuestToken: String?
}

enum GuestCloudSessionRecord: Sendable {
    case current(StoredGuestCloudSession)
    case legacy(LegacyStoredGuestCloudSession)
}

struct GuestCloudSessionDiscovery: Sendable {
    let record: GuestCloudSessionRecord?
    let sidecar: Result<StoredGuestCloudSessionSidecar?, Error>
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

final class GuestCloudCredentialStore: Sendable {
    @MainActor private(set) var revision = UUID()
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let service: String
    private let account: String
    private let bundle: Bundle
    @MainActor private let userDefaults: UserDefaults

    @MainActor
    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        service: String = appBundleIdentifier() + ".guest-cloud-auth",
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

    private var sidecarAccount: String {
        self.account + ".sidecar"
    }

    @MainActor
    func loadGuestSession() throws -> StoredGuestCloudSession? {
        try self.resolveGuestSession(record: self.readGuestSessionRecord())
    }

    func discoverGuestSession(cloudState: CloudAccountState?) throws -> GuestCloudSessionDiscovery {
        let record = try self.readGuestSessionRecord()
        // An adopted credential needs no marker read. A wrong-server record clears its whole sidecar.
        let sidecar: Result<StoredGuestCloudSessionSidecar?, Error> = if record != nil, cloudState == .guest {
            .success(nil)
        } else {
            Result { try self.loadSidecar() }
        }
        return GuestCloudSessionDiscovery(record: record, sidecar: sidecar)
    }

    private func readGuestSessionRecord() throws -> GuestCloudSessionRecord? {
        guard let data = try self.loadData(account: self.account) else {
            return nil
        }
        if let session = try? self.decoder.decode(StoredGuestCloudSession.self, from: data) {
            return .current(session)
        }
        if let session = try? self.decoder.decode(LegacyStoredGuestCloudSession.self, from: data) {
            return .legacy(session)
        }

        throw GuestCloudCredentialStoreError.decodingFailed
    }

    @MainActor
    func saveGuestSession(session: StoredGuestCloudSession) throws {
        let data: Data
        do {
            data = try self.encoder.encode(session)
        } catch {
            throw GuestCloudCredentialStoreError.encodingFailed
        }

        try self.saveData(data: data, account: self.account)
    }

    /**
     * Clears the sidecar with the session.
     *
     * The analytics-only marker only ever describes the credential being removed, so it has to go
     * with it. The creation key is different: `createAndStoreGuestCloudSession` clears it as soon as
     * a session is stored, so a key still here names a creation attempt whose outcome this install
     * never learned, not the credential being removed. It is dropped with it deliberately, because
     * the identity boundary this clear usually serves must not let the next creation rotate a guest
     * that belongs to the person who just left. The cost is accepted: if that attempt did create a
     * guest, the only handle that could have reclaimed it by rotation is gone, and it stays a
     * permanent orphan user and workspace, which the reaper never collects for mobile guests.
     */
    @MainActor
    func clearGuestSession() throws {
        try self.deleteData(account: self.account)
        try self.deleteData(account: self.sidecarAccount)
    }

    func loadGuestSessionCreationIdempotencyKey() throws -> String? {
        try self.loadSidecar()?.creationIdempotencyKey
    }

    @MainActor
    func saveGuestSessionCreationIdempotencyKey(idempotencyKey: String) throws {
        let sidecar = try self.loadSidecar()
        try self.saveSidecar(
            sidecar: StoredGuestCloudSessionSidecar(
                creationIdempotencyKey: idempotencyKey,
                analyticsOnlyGuestToken: sidecar?.analyticsOnlyGuestToken
            )
        )
    }

    @MainActor
    func clearGuestSessionCreationIdempotencyKey() throws {
        guard let sidecar = try self.loadSidecar(), sidecar.creationIdempotencyKey != nil else {
            return
        }

        try self.saveSidecar(
            sidecar: StoredGuestCloudSessionSidecar(
                creationIdempotencyKey: nil,
                analyticsOnlyGuestToken: sidecar.analyticsOnlyGuestToken
            )
        )
    }

    func loadAnalyticsOnlyGuestToken() throws -> String? {
        try self.loadSidecar()?.analyticsOnlyGuestToken
    }

    @MainActor
    func saveAnalyticsOnlyGuestToken(guestToken: String) throws {
        let sidecar = try self.loadSidecar()
        try self.saveSidecar(
            sidecar: StoredGuestCloudSessionSidecar(
                creationIdempotencyKey: sidecar?.creationIdempotencyKey,
                analyticsOnlyGuestToken: guestToken
            )
        )
    }

    @MainActor
    func clearAnalyticsOnlyGuestToken() throws {
        try self.clearAnalyticsOnlyGuestToken(sidecar: self.loadSidecar())
    }

    @MainActor
    func clearAnalyticsOnlyGuestToken(sidecar: StoredGuestCloudSessionSidecar?) throws {
        guard let sidecar, sidecar.analyticsOnlyGuestToken != nil else {
            return
        }

        try self.saveSidecar(
            sidecar: StoredGuestCloudSessionSidecar(
                creationIdempotencyKey: sidecar.creationIdempotencyKey,
                analyticsOnlyGuestToken: nil
            )
        )
    }

    /**
     * Returns nil when no sidecar is stored, and throws only in a state this store makes unreachable.
     *
     * `decodingFailed` needs sidecar bytes nothing here can write. `saveSidecar` is the only writer of
     * the `.sidecar` account — nothing outside this type touches this Keychain service — and it always
     * encodes exactly `StoredGuestCloudSessionSidecar`, whose every field is optional, so bytes
     * written by any other build of this app still decode. Keep every field optional for that reason:
     * a required one would make this throw for every install that already stored a sidecar, and
     * nothing here repairs a sidecar that will not decode.
     *
     * `unexpectedStatus` needs the Keychain to refuse this item while allowing the session record,
     * which every caller reads first. Both items share `service` and
     * `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so no status can separate them: a refusal
     * reaches the session record and the sidecar is never asked for.
     *
     * If that ever stops holding, this needs a self-healing read rather than a throw, because the
     * consequences are permanent. `loadOrCreateGuestCloudSession` clears the marker fatally, so a
     * `.guest` install would fail every sync and every AI-chat and feedback guest preparation, and the
     * polling reconciliation would silently skip
     * the guest cloud restore of a reinstalled real guest install.
     */
    private func loadSidecar() throws -> StoredGuestCloudSessionSidecar? {
        guard let data = try self.loadData(account: self.sidecarAccount) else {
            return nil
        }

        do {
            return try self.decoder.decode(StoredGuestCloudSessionSidecar.self, from: data)
        } catch {
            throw GuestCloudCredentialStoreError.decodingFailed
        }
    }

    @MainActor
    private func saveSidecar(sidecar: StoredGuestCloudSessionSidecar) throws {
        let data: Data
        do {
            data = try self.encoder.encode(sidecar)
        } catch {
            throw GuestCloudCredentialStoreError.encodingFailed
        }

        try self.saveData(data: data, account: self.sidecarAccount)
    }

    private func loadData(account: String) throws -> Data? {
        if self.usesTestFileStorage {
            return try self.loadTestFileData(account: account)
        }

        var result: CFTypeRef?
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: account,
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

        return data
    }

    @MainActor
    private func saveData(data: Data, account: String) throws {
        self.revision = UUID()
        if self.usesTestFileStorage {
            try data.write(to: self.testStorageUrl(account: account), options: .atomic)
            return
        }

        let baseQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: account,
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

    @MainActor
    private func deleteData(account: String) throws {
        self.revision = UUID()
        if self.usesTestFileStorage {
            try self.deleteTestFileData(account: account)
            return
        }

        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: self.service,
            kSecAttrAccount: account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }

        throw GuestCloudCredentialStoreError.unexpectedStatus(status, "delete")
    }

    private func testStorageUrl(account: String) -> URL {
        let fileName = "\(self.service)-\(account)-guest-cloud-session.json"
            .replacingOccurrences(of: "/", with: "-")
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName, isDirectory: false)
    }

    private func loadTestFileData(account: String) throws -> Data? {
        let fileUrl = self.testStorageUrl(account: account)
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return nil
        }

        return try Data(contentsOf: fileUrl)
    }

    private func deleteTestFileData(account: String) throws {
        let fileUrl = self.testStorageUrl(account: account)
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return
        }

        try FileManager.default.removeItem(at: fileUrl)
    }

    @MainActor
    func resolveGuestSession(record: GuestCloudSessionRecord?) throws -> StoredGuestCloudSession? {
        switch record {
        case .current(let session):
            return canonicalizedStoredGuestCloudSession(
                session: session,
                configuration: try self.currentCloudServiceConfiguration()
            )
        case .legacy(let session):
            return try self.migrateLegacyGuestSession(session: session)
        case nil:
            return nil
        }
    }

    @MainActor
    private func currentCloudServiceConfiguration() throws -> CloudServiceConfiguration {
        do {
            return try loadCloudServiceConfiguration(
                bundle: self.bundle,
                userDefaults: self.userDefaults,
                decoder: self.decoder
            )
        } catch {
            throw GuestCloudCredentialStoreError.migrationFailed(Flashcards.errorMessage(error: error))
        }
    }

    @MainActor
    private func migrateLegacyGuestSession(session: LegacyStoredGuestCloudSession) throws -> StoredGuestCloudSession {
        let configuration = try self.currentCloudServiceConfiguration()

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
