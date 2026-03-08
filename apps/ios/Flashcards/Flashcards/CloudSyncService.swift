import Foundation

enum CloudSyncError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl(let value):
            return "Cloud sync base URL is invalid: \(value)"
        case .invalidResponse(let statusCode, let body):
            return "Cloud sync request failed with status \(statusCode): \(body)"
        }
    }

    var statusCode: Int? {
        switch self {
        case .invalidResponse(let statusCode, _):
            return statusCode
        case .invalidBaseUrl:
            return nil
        }
    }
}

private struct MeResponse: Decodable {
    struct Profile: Decodable {
        let email: String?
    }

    let userId: String
    let workspaceId: String
    let profile: Profile
}

private struct PushRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let operations: [SyncOperationEnvelope]
}

private struct PullRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let afterChangeId: Int64
    let limit: Int
}

private struct SyncOperationEnvelope: Encodable {
    let operation: SyncOperation

    enum CodingKeys: String, CodingKey {
        case operationId
        case entityType
        case entityId
        case action
        case clientUpdatedAt
        case payload
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operation.operationId, forKey: .operationId)
        try container.encode(operation.entityType, forKey: .entityType)
        try container.encode(operation.entityId, forKey: .entityId)
        try container.encode(operation.action, forKey: .action)
        try container.encode(operation.clientUpdatedAt, forKey: .clientUpdatedAt)

        switch operation.payload {
        case .card(let payload):
            try container.encode(payload, forKey: .payload)
        case .deck(let payload):
            try container.encode(payload, forKey: .payload)
        case .workspaceSchedulerSettings(let payload):
            try container.encode(payload, forKey: .payload)
        case .reviewEvent(let payload):
            try container.encode(payload, forKey: .payload)
        }
    }
}

private struct PullResponseEnvelope: Decodable {
    let changes: [SyncChangeEnvelope]
    let nextChangeId: Int64
    let hasMore: Bool
}

private struct SyncChangeEnvelope: Decodable {
    let changeId: Int64
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: SyncChangePayload

    enum CodingKeys: String, CodingKey {
        case changeId
        case entityType
        case entityId
        case action
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.changeId = try container.decode(Int64.self, forKey: .changeId)
        self.entityType = try container.decode(SyncEntityType.self, forKey: .entityType)
        self.entityId = try container.decode(String.self, forKey: .entityId)
        self.action = try container.decode(SyncAction.self, forKey: .action)

        switch self.entityType {
        case .card:
            self.payload = .card(try container.decode(Card.self, forKey: .payload))
        case .deck:
            self.payload = .deck(try container.decode(Deck.self, forKey: .payload))
        case .workspaceSchedulerSettings:
            self.payload = .workspaceSchedulerSettings(
                try container.decode(WorkspaceSchedulerSettings.self, forKey: .payload)
            )
        case .reviewEvent:
            self.payload = .reviewEvent(try container.decode(ReviewEvent.self, forKey: .payload))
        }
    }
}

@MainActor
final class CloudSyncService {
    private let database: LocalDatabase
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let session: URLSession

    init(database: LocalDatabase, session: URLSession = .shared) {
        self.database = database
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.session = session
    }

    func fetchLinkedSession(apiBaseUrl: String, bearerToken: String) async throws -> CloudLinkedSession {
        let response: MeResponse = try await self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )

        return CloudLinkedSession(
            userId: response.userId,
            workspaceId: response.workspaceId,
            email: response.profile.email,
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken
        )
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        let cloudSettings = try self.database.loadStateSnapshot().cloudSettings
        let workspaceId = linkedSession.workspaceId

        while true {
            let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
            if outboxEntries.isEmpty {
                break
            }

            do {
                let pushResponse: SyncPushResponse = try await self.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    bearerToken: linkedSession.bearerToken,
                    path: "/sync/push",
                    method: "POST",
                    body: PushRequest(
                        deviceId: cloudSettings.deviceId,
                        platform: "ios",
                        appVersion: self.appVersion(),
                        operations: outboxEntries.map { entry in
                            SyncOperationEnvelope(operation: entry.operation)
                        }
                    )
                )

                try self.database.deleteOutboxEntries(
                    operationIds: pushResponse.operations.map { result in
                        result.operationId
                    }
                )
            } catch {
                try self.database.markOutboxEntriesFailed(
                    operationIds: outboxEntries.map { entry in
                        entry.operationId
                    },
                    message: error.localizedDescription
                )
                throw error
            }
        }

        var afterChangeId = try self.database.loadLastAppliedChangeId(workspaceId: workspaceId)
        while true {
            let pullEnvelope: PullResponseEnvelope = try await self.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                bearerToken: linkedSession.bearerToken,
                path: "/sync/pull",
                method: "POST",
                body: PullRequest(
                    deviceId: cloudSettings.deviceId,
                    platform: "ios",
                    appVersion: self.appVersion(),
                    afterChangeId: afterChangeId,
                    limit: 200
                )
            )

            for change in pullEnvelope.changes {
                try self.database.applySyncChange(
                    workspaceId: workspaceId,
                    change: SyncChange(
                        changeId: change.changeId,
                        entityType: change.entityType,
                        entityId: change.entityId,
                        action: change.action,
                        payload: change.payload
                    )
                )
            }

            afterChangeId = pullEnvelope.nextChangeId
            try self.database.setLastAppliedChangeId(workspaceId: workspaceId, changeId: afterChangeId)

            if pullEnvelope.hasMore == false {
                break
            }
        }
    }

    private func appVersion() -> String {
        let shortVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return shortVersion ?? "0.1.0"
    }

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudSyncError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        bearerToken: String,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        if let body {
            request.httpBody = try self.encoder.encode(body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud sync did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            throw CloudSyncError.invalidResponse(
                httpResponse.statusCode,
                parseCloudSyncErrorMessage(data: data)
            )
        }

        return try self.decoder.decode(Response.self, from: data)
    }
}

private func parseCloudSyncErrorMessage(data: Data) -> String {
    if
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let message = object["error"] as? String,
        message.isEmpty == false
    {
        return message
    }

    return String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
}
