import Foundation
import XCTest
@testable import Flashcards

enum LinkedSyncRunnerTestTransportSupport {
    static func handleLinkedSyncRetryTestRequest(
        request: URLRequest,
        sourceCardId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            let body = try Self.jsonObjectBody(request: request)
            let mode = try XCTUnwrap(body["mode"] as? String)
            if mode == "pull" {
                return try Self.jsonResponse(
                    request: request,
                    statusCode: 200,
                    body: """
                    {
                      "entries": [],
                      "nextCursor": null,
                      "hasMore": false,
                      "bootstrapHotChangeId": 0,
                      "remoteIsEmpty": true
                    }
                    """
                )
            }

            let entries = try XCTUnwrap(body["entries"] as? [[String: Any]])
            let cardEntry = try XCTUnwrap(entries.first { entry in
                entry["entityType"] as? String == SyncEntityType.card.rawValue
            })
            let cardEntityId = try XCTUnwrap(cardEntry["entityId"] as? String)
            CloudSyncRunnerTestURLProtocol.bootstrapPushCardIds.append(cardEntityId)
            if CloudSyncRunnerTestURLProtocol.bootstrapPushCardIds.count == 1 {
                return try Self.jsonResponse(
                    request: request,
                    statusCode: 409,
                    body: """
                    {
                      "error": "Sync detected content copied from another workspace. Retry after forking ids.",
                      "requestId": "request-fork",
                      "code": "SYNC_WORKSPACE_FORK_REQUIRED",
                      "details": {
                        "syncConflict": {
                          "phase": "bootstrap",
                          "entityType": "card",
                          "entityId": "\(sourceCardId)",
                          "entryIndex": 0,
                          "recoverable": true
                        }
                      }
                    }
                    """
                )
            }

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "appliedEntriesCount": 2,
                  "bootstrapHotChangeId": 1
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 1,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    static func handleLargeEmptyRemoteBootstrapRequest(
        request: URLRequest,
        expectedEntryCount: Int
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            let body = try Self.jsonObjectBody(request: request)
            let mode = try XCTUnwrap(body["mode"] as? String)
            if mode == "pull" {
                return try Self.jsonResponse(
                    request: request,
                    statusCode: 200,
                    body: """
                    {
                      "entries": [],
                      "nextCursor": null,
                      "hasMore": false,
                      "bootstrapHotChangeId": 0,
                      "remoteIsEmpty": true
                    }
                    """
                )
            }

            XCTAssertEqual("push", mode)
            let entries = try XCTUnwrap(body["entries"] as? [[String: Any]])
            CloudSyncRunnerTestURLProtocol.bootstrapPushEntryCounts.append(entries.count)
            XCTAssertEqual(expectedEntryCount, entries.count)
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "appliedEntriesCount": \(entries.count),
                  "bootstrapHotChangeId": 77
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 77,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    static func handleLinkedSyncPushRetryTestRequest(
        request: URLRequest,
        sourceEntityType: SyncEntityType,
        sourceEntityId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(WorkspaceSyncPushRetryRequestBody.self, from: Self.requestBodyData(request: request))
            let conflictingOperation = try XCTUnwrap(body.operations.first { operation in
                operation.entityType == sourceEntityType
            })
            let entityId = conflictingOperation.entityId
            CloudSyncRunnerTestURLProtocol.pushEntityIds.append(entityId)

            if CloudSyncRunnerTestURLProtocol.pushEntityIds.count == 1 {
                return try Self.jsonResponse(
                    request: request,
                    statusCode: 409,
                    body: """
                    {
                      "error": "Sync detected content copied from another workspace. Retry after forking ids.",
                      "requestId": "request-fork",
                      "code": "SYNC_WORKSPACE_FORK_REQUIRED",
                      "details": {
                        "syncConflict": {
                          "phase": "push",
                          "entityType": "\(sourceEntityType.rawValue)",
                          "entityId": "\(sourceEntityId)",
                          "entryIndex": 0,
                          "recoverable": true
                        }
                      }
                    }
                    """
                )
            }

            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 2,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 2,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 1,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    static func handleLinkedSyncMultiConflictPushRetryTestRequest(
        request: URLRequest,
        sourceCardId: String,
        sourceDeckId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(WorkspaceSyncPushRetryRequestBody.self, from: Self.requestBodyData(request: request))
            let entityIdsByType: [String: String] = body.operations.reduce(into: [:]) { result, operation in
                result[operation.entityType.rawValue] = operation.entityId
            }
            CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.append(entityIdsByType)

            if CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.count == 1 {
                return try Self.workspaceForkRequiredJsonResponse(
                    request: request,
                    requestId: "request-fork-card",
                    entityType: .card,
                    entityId: sourceCardId
                )
            }

            if CloudSyncRunnerTestURLProtocol.pushEntitySnapshots.count == 2 {
                return try Self.workspaceForkRequiredJsonResponse(
                    request: request,
                    requestId: "request-fork-deck",
                    entityType: .deck,
                    entityId: sourceDeckId
                )
            }

            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 2,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 2,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 1,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    static func handleDirtyBootstrapProtectionRequest(
        request: URLRequest,
        workspaceId: String,
        dirtyCardId: String,
        dirtyDeckId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "entries": [
                    {
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote bootstrap question",
                        "backText": "Remote bootstrap answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "card",
                      "entityId": "remote-clean-card",
                      "action": "upsert",
                      "payload": {
                        "cardId": "remote-clean-card",
                        "frontText": "Clean remote question",
                        "backText": "Clean remote answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-clean-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "deck",
                      "entityId": "\(dirtyDeckId)",
                      "action": "upsert",
                      "payload": {
                        "deckId": "\(dirtyDeckId)",
                        "name": "Remote bootstrap deck",
                        "filterDefinition": {
                          "version": 2,
                          "effortLevels": ["medium"],
                          "tags": ["remote"]
                        },
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-deck-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    },
                    {
                      "entityType": "workspace_scheduler_settings",
                      "entityId": "\(workspaceId)",
                      "action": "upsert",
                      "payload": {
                        "algorithm": "fsrs-6",
                        "desiredRetention": 0.5,
                        "learningStepsMinutes": [5],
                        "relearningStepsMinutes": [5],
                        "maximumIntervalDays": 30,
                        "enableFuzz": false,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-settings-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z"
                      }
                    }
                  ],
                  "nextCursor": null,
                  "hasMore": false,
                  "bootstrapHotChangeId": 20,
                  "remoteIsEmpty": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(WorkspaceSyncPushRetryRequestBody.self, from: Self.requestBodyData(request: request))
            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "applied",
                  "resultingHotChangeId": 21,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [],
                  "nextHotChangeId": 21,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    static func handleIgnoredDirtyBootstrapProtectionRequest(
        request: URLRequest,
        dirtyCardId: String
    ) throws -> (HTTPURLResponse, Data) {
        let path = try XCTUnwrap(request.url?.path)
        if path.hasSuffix("/sync/bootstrap") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "entries": [
                    {
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote winning question",
                        "backText": "Remote winning answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    }
                  ],
                  "nextCursor": null,
                  "hasMore": false,
                  "bootstrapHotChangeId": 20,
                  "remoteIsEmpty": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/push") {
            let body = try JSONDecoder().decode(WorkspaceSyncPushRetryRequestBody.self, from: Self.requestBodyData(request: request))
            let operationResults = body.operations.map { operation -> String in
                return """
                {
                  "operationId": "\(operation.operationId)",
                  "entityType": "\(operation.entityType.rawValue)",
                  "entityId": "\(operation.entityId)",
                  "status": "ignored",
                  "resultingHotChangeId": null,
                  "error": null
                }
                """
            }.joined(separator: ",")

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "operations": [\(operationResults)]
                }
                """
            )
        }

        if path.hasSuffix("/sync/pull") {
            let body = try Self.jsonObjectBody(request: request)
            let afterHotChangeId = try XCTUnwrap(body["afterHotChangeId"] as? NSNumber).int64Value
            CloudSyncRunnerTestURLProtocol.pullAfterHotChangeIds.append(afterHotChangeId)
            let changes: String
            if afterHotChangeId == 0 {
                changes = """
                    {
                      "changeId": 20,
                      "entityType": "card",
                      "entityId": "\(dirtyCardId)",
                      "action": "upsert",
                      "payload": {
                        "cardId": "\(dirtyCardId)",
                        "frontText": "Remote winning question",
                        "backText": "Remote winning answer",
                        "tags": ["remote"],
                        "effortLevel": "medium",
                        "dueAt": null,
                        "createdAt": "2026-04-01T00:00:00.000Z",
                        "reps": 0,
                        "lapses": 0,
                        "fsrsCardState": "new",
                        "fsrsStepIndex": null,
                        "fsrsStability": null,
                        "fsrsDifficulty": null,
                        "fsrsLastReviewedAt": null,
                        "fsrsScheduledDays": null,
                        "clientUpdatedAt": "2030-01-01T00:00:00.000Z",
                        "lastModifiedByReplicaId": "remote-replica",
                        "lastOperationId": "remote-card-operation",
                        "updatedAt": "2030-01-01T00:00:00.000Z",
                        "deletedAt": null
                      }
                    }
                """
            } else {
                changes = ""
            }

            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "changes": [\(changes)],
                  "nextHotChangeId": 20,
                  "hasMore": false
                }
                """
            )
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: """
                {
                  "reviewEvents": [],
                  "nextReviewSequenceId": 0,
                  "hasMore": false
                }
                """
            )
        }

        XCTFail("Unexpected sync request path: \(path)")
        throw URLError(.badURL)
    }

    private static func workspaceForkRequiredJsonResponse(
        request: URLRequest,
        requestId: String,
        entityType: SyncEntityType,
        entityId: String
    ) throws -> (HTTPURLResponse, Data) {
        try Self.jsonResponse(
            request: request,
            statusCode: 409,
            body: """
            {
              "error": "Sync detected content copied from another workspace. Retry after forking ids.",
              "requestId": "\(requestId)",
              "code": "SYNC_WORKSPACE_FORK_REQUIRED",
              "details": {
                "syncConflict": {
                  "phase": "push",
                  "entityType": "\(entityType.rawValue)",
                  "entityId": "\(entityId)",
                  "entryIndex": 0,
                  "recoverable": true
                }
              }
            }
            """
        )
    }

    private static func jsonObjectBody(request: URLRequest) throws -> [String: Any] {
        let data = try Self.requestBodyData(request: request)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    private static func requestBodyData(request: URLRequest) throws -> Data {
        if let httpBody = request.httpBody {
            return httpBody
        }

        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer {
            stream.close()
        }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let readCount = stream.read(&buffer, maxLength: buffer.count)
            if readCount > 0 {
                data.append(buffer, count: readCount)
            } else if readCount == 0 {
                return data
            } else {
                throw stream.streamError ?? URLError(.cannotDecodeRawData)
            }
        }
    }

    private static func jsonResponse(
        request: URLRequest,
        statusCode: Int,
        body: String
    ) throws -> (HTTPURLResponse, Data) {
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )
        )
        return (response, Data(body.utf8))
    }

}

final class CloudSyncRunnerTestURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    nonisolated(unsafe) static var bootstrapPushCardIds: [String] = []
    nonisolated(unsafe) static var bootstrapPushEntryCounts: [Int] = []
    nonisolated(unsafe) static var pushEntityIds: [String] = []
    nonisolated(unsafe) static var pushEntitySnapshots: [[String: String]] = []
    nonisolated(unsafe) static var pullAfterHotChangeIds: [Int64] = []

    override class func canInit(with request: URLRequest) -> Bool {
        _ = request
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let requestHandler = Self.requestHandler else {
            self.client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try requestHandler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {
    }

    static func reset() {
        self.requestHandler = nil
        self.bootstrapPushCardIds = []
        self.bootstrapPushEntryCounts = []
        self.pushEntityIds = []
        self.pushEntitySnapshots = []
        self.pullAfterHotChangeIds = []
    }
}
