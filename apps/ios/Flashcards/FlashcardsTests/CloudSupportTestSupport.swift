import Foundation
import XCTest
@testable import Flashcards

enum CloudSupportTestSupport {
    static func clearRequestHandler() {
        CloudSupportMockUrlProtocol.requestHandler = nil
    }

    static func setRequestHandler(
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) {
        CloudSupportMockUrlProtocol.requestHandler = handler
    }

    static func makeBundle(testCase: XCTestCase, infoDictionary: [String: String]) throws -> Bundle {
        let rootUrl = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bundleUrl = rootUrl.appendingPathExtension("bundle")

        try FileManager.default.createDirectory(at: bundleUrl, withIntermediateDirectories: true)
        testCase.addTeardownBlock {
            try? FileManager.default.removeItem(at: rootUrl)
        }

        let infoPlistUrl = bundleUrl.appendingPathComponent("Info.plist")
        let infoPlistData = try PropertyListSerialization.data(
            fromPropertyList: infoDictionary,
            format: .xml,
            options: 0
        )
        try infoPlistData.write(to: infoPlistUrl)

        return try XCTUnwrap(Bundle(url: bundleUrl))
    }

    static func makeUserDefaults(testCase: XCTestCase) throws -> UserDefaults {
        let suiteName = "cloud-support-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        testCase.addTeardownBlock { [suiteName] in
            UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        }
        return userDefaults
    }

    static func makeDatabaseWithURL() throws -> (URL, LocalDatabase) {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString,
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)

        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        return (databaseURL, try LocalDatabase(databaseURL: databaseURL))
    }

    static func makeCardInput(frontText: String, backText: String) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: ["tag-a"],
            effortLevel: .medium
        )
    }

    static func makeCloudWorkspaceSummary(workspaceId: String) -> CloudWorkspaceSummary {
        CloudWorkspaceSummary(
            workspaceId: workspaceId,
            name: "Personal",
            createdAt: "2026-03-12T10:00:00.000Z",
            isSelected: false
        )
    }

    static func makeCloudWorkspaceLinkContext(workspaces: [CloudWorkspaceSummary]) -> CloudWorkspaceLinkContext {
        CloudWorkspaceLinkContext(
            userId: "user-id",
            email: "user@example.com",
            apiBaseUrl: "https://api.example.com/v1",
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2026-03-12T12:00:00.000Z"
            ),
            workspaces: workspaces,
            guestUpgradeMode: nil
        )
    }

    static func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-id",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com/v1",
            authorization: .bearer("id-token")
        )
    }

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSupportMockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }

    static func requestBodyObject(request: URLRequest) throws -> [String: Any] {
        let bodyData = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
    }

    static func updateStoredDeviceId(databaseURL: URL, deviceId: String) throws {
        let core = try DatabaseCore(databaseURL: databaseURL)
        _ = try core.execute(
            sql: """
            UPDATE app_local_settings
            SET device_id = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(deviceId),
                .text(nowIsoTimestamp())
            ]
        )
    }

    static func emptySyncPullResponseData() -> Data {
        """
        {"changes":[],"nextHotChangeId":0,"hasMore":false}
        """.data(using: .utf8)!
    }

    static func emptyReviewHistoryPullResponseData() -> Data {
        """
        {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
        """.data(using: .utf8)!
    }

    static func makeAppliedOperationResultsData(operations: [[String: Any]]) throws -> Data {
        let results = operations.compactMap { operation -> [String: Any]? in
            guard
                let operationId = operation["operationId"] as? String,
                let entityType = operation["entityType"] as? String,
                let entityId = operation["entityId"] as? String
            else {
                return nil
            }

            return [
                "operationId": operationId,
                "entityType": entityType,
                "entityId": entityId,
                "status": "applied",
                "resultingHotChangeId": 1,
                "error": NSNull()
            ]
        }

        return try JSONSerialization.data(withJSONObject: ["operations": results])
    }

    static func prepareHydratedSyncState(database: LocalDatabase, workspaceId: String) throws {
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)
    }
}

final class CloudSupportRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storedRequestPaths: [String]
    private var storedPushedEntityTypes: [String]

    init() {
        self.storedRequestPaths = []
        self.storedPushedEntityTypes = []
    }

    var requestPaths: [String] {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.storedRequestPaths
    }

    var pushedEntityTypes: [String] {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.storedPushedEntityTypes
    }

    func appendPath(_ path: String) {
        self.lock.lock()
        self.storedRequestPaths.append(path)
        self.lock.unlock()
    }

    func setPushedEntityTypes(_ entityTypes: [String]) {
        self.lock.lock()
        self.storedPushedEntityTypes = entityTypes
        self.lock.unlock()
    }
}

private final class CloudSupportMockUrlProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = CloudSupportMockUrlProtocol.requestHandler else {
            XCTFail("CloudSupportMockUrlProtocol.requestHandler is not set")
            return
        }

        do {
            let (response, data) = try handler(materializedRequest(self.request))
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
