import Foundation
import XCTest
@testable import Flashcards

final class CloudSyncContractTests: XCTestCase, @unchecked Sendable {
    override func tearDown() {
        CloudSupportTestSupport.clearRequestHandler()
        super.tearDown()
    }

    // MARK: - Bootstrap

    /// Guards the first bootstrap request contract used by
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
    ///
    /// The backend validator in `apps/backend/src/sync.ts` requires the
    /// `cursor` key to be present, so the first page must send JSON `null`
    /// instead of omitting the field.
    @MainActor
    func testRunLinkedSyncBootstrapRequestIncludesNullCursorOnFirstPage() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
                XCTAssertTrue(bodyObject.keys.contains("cursor"))
                XCTAssertTrue(bodyObject["cursor"] is NSNull)

                let data = """
                {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":0,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                return (response, CloudSupportTestSupport.emptySyncPullResponseData())
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards follow-up bootstrap pages so the runtime sender and backend parser
    /// stay aligned on cursor pagination semantics.
    ///
    /// If you change request encoding in
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`, update this test
    /// and `apps/backend/src/sync.ts` together.
    @MainActor
    func testRunLinkedSyncBootstrapRequestIncludesCursorOnFollowUpPages() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bootstrapRequestCount = recorder.requestPaths.filter { $0.hasSuffix("/sync/bootstrap") }.count
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])

                if bootstrapRequestCount == 1 {
                    XCTAssertTrue(bodyObject["cursor"] is NSNull)
                    let data = """
                    {"mode":"pull","entries":[],"nextCursor":"cursor-1","hasMore":true,"bootstrapHotChangeId":7,"remoteIsEmpty":false}
                    """.data(using: .utf8)!
                    return (response, data)
                }

                XCTAssertEqual(bodyObject["cursor"] as? String, "cursor-1")
                let data = """
                {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":7,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":7,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards the `/sync/bootstrap` pull response shape consumed by
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
    @MainActor
    func testRunLinkedSyncBootstrapPullAppliesBackendEntryEnvelopeShape() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let data = """
                {"mode":"pull","entries":[{"entityType":"card","entityId":"remote-card-1","action":"upsert","payload":{"cardId":"remote-card-1","frontText":"Remote front","backText":"Remote back","tags":["remote"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-03-09T10:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"clientUpdatedAt":"2026-03-09T10:00:00.000Z","lastModifiedByDeviceId":"remote-device","lastOperationId":"remote-operation","updatedAt":"2026-03-09T10:00:00.000Z","deletedAt":null}}],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":9,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":9,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].cardId, "remote-card-1")
        XCTAssertEqual(cards[0].frontText, "Remote front")
        XCTAssertEqual(try database.loadLastAppliedHotChangeId(workspaceId: workspaceId), 9)
        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards the empty-remote bootstrap upload contracts for both hot state and
    /// review-history import.
    @MainActor
    func testRunLinkedSyncEmptyRemoteBootstrapEncodesBootstrapPushAndReviewHistoryImport() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let savedCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: [])
            )
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                let mode = bodyObject["mode"] as? String
                if mode == "pull" {
                    XCTAssertTrue(bodyObject["cursor"] is NSNull)
                    let data = """
                    {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":0,"remoteIsEmpty":true}
                    """.data(using: .utf8)!
                    return (response, data)
                }

                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                let entries = try XCTUnwrap(bodyObject["entries"] as? [[String: Any]])
                let entityTypes = Set(entries.compactMap { $0["entityType"] as? String })
                XCTAssertEqual(entityTypes, ["card", "deck", "workspace_scheduler_settings"])
                let data = """
                {"mode":"push","appliedEntriesCount":\(entries.count),"bootstrapHotChangeId":12}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/review-history/import") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                let reviewEvents = try XCTUnwrap(bodyObject["reviewEvents"] as? [[String: Any]])
                XCTAssertEqual(reviewEvents.count, 1)
                XCTAssertEqual(reviewEvents[0]["cardId"] as? String, savedCard.cardId)
                let data = """
                {"importedCount":1,"duplicateCount":0,"nextReviewSequenceId":7}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":12,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":7,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = self.makeService(database: database)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/review-history/import",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    // MARK: - Push

    /// Guards the `/sync/push` wire format used by the iOS outbox sender.
    ///
    /// Keep this test aligned with `apps/backend/src/sync.ts`
    /// `syncPushInputSchema`.
    @MainActor
    func testRunLinkedSyncPushRequestIncludesSharedEnvelopeFields() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/push") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                XCTAssertEqual(bodyObject["appVersion"] as? String, "1.0.1")

                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                XCTAssertEqual(operations.count, 1)
                XCTAssertEqual(operations[0]["entityType"] as? String, "card")
                XCTAssertEqual(operations[0]["action"] as? String, "upsert")
                let payload = try XCTUnwrap(operations[0]["payload"] as? [String: Any])
                XCTAssertEqual(payload["frontText"] as? String, "Front")
                XCTAssertEqual(payload["backText"] as? String, "Back")

                let data = try CloudSupportTestSupport.makeAppliedOperationResultsData(operations: operations)
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":1,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/push",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    @MainActor
    func testRunLinkedSyncDropsStaleReviewEventOperationsBeforePush() async throws {
        let (databaseURL, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )
        try CloudSupportTestSupport.updateStoredDeviceId(
            databaseURL: databaseURL,
            deviceId: "replacement-device-id"
        )

        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            if url.path.hasSuffix("/sync/push") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, "replacement-device-id")
                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                let entityTypes = operations.compactMap { operation in
                    operation["entityType"] as? String
                }
                recorder.setPushedEntityTypes(entityTypes)

                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let data = try CloudSupportTestSupport.makeAppliedOperationResultsData(operations: operations)
                return (response, data)
            }

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            if url.path.hasSuffix("/sync/pull") {
                return (response, CloudSupportTestSupport.emptySyncPullResponseData())
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let requestPaths = recorder.requestPaths
        let pushedEntityTypes = recorder.pushedEntityTypes
        XCTAssertEqual(
            requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/push",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
        XCTAssertEqual(pushedEntityTypes.filter { $0 == "review_event" }.count, 0)
        XCTAssertEqual(pushedEntityTypes.count, 2)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
        XCTAssertEqual(try database.loadReviewEvents(workspaceId: workspaceId).count, 1)
    }

    @MainActor
    func testRunLinkedSyncSkipsPushWhenCleanupRemovesEntireOutboxBatch() async throws {
        let (databaseURL, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? nil : entry.operationId
        })
        try CloudSupportTestSupport.updateStoredDeviceId(
            databaseURL: databaseURL,
            deviceId: "replacement-device-id"
        )

        let recorder = CloudSupportRequestRecorder()
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            if url.path.hasSuffix("/sync/pull") {
                return (response, CloudSupportTestSupport.emptySyncPullResponseData())
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let requestPaths = recorder.requestPaths
        XCTAssertEqual(requestPaths, [
            "/v1/workspaces/\(workspaceId)/sync/pull",
            "/v1/workspaces/\(workspaceId)/sync/review-history/pull",
        ])
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
        XCTAssertEqual(try database.loadReviewEvents(workspaceId: workspaceId).count, 1)
    }

    // MARK: - Pull

    /// Guards the `/sync/pull` request and response envelopes together.
    @MainActor
    func testRunLinkedSyncPullRequestIncludesHotCursorAndAppliesBackendResponse() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/pull") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                XCTAssertEqual(bodyObject["afterHotChangeId"] as? Int64, 33)
                XCTAssertEqual(bodyObject["limit"] as? Int, 200)

                let data = """
                {"changes":[{"changeId":34,"entityType":"card","entityId":"remote-card-2","action":"upsert","payload":{"cardId":"remote-card-2","frontText":"Pulled front","backText":"Pulled back","tags":["pulled"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-03-09T10:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"clientUpdatedAt":"2026-03-09T10:00:00.000Z","lastModifiedByDeviceId":"remote-device","lastOperationId":"remote-operation","updatedAt":"2026-03-09T10:00:00.000Z","deletedAt":null}}],"nextHotChangeId":34,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            return (response, CloudSupportTestSupport.emptyReviewHistoryPullResponseData())
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)
        try database.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: 33)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].cardId, "remote-card-2")
        XCTAssertEqual(cards[0].frontText, "Pulled front")
        XCTAssertEqual(try database.loadLastAppliedHotChangeId(workspaceId: workspaceId), 34)
    }

    func testRunLinkedSyncCanExecuteOffMainActor() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/push") {
                let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                let data = try CloudSupportTestSupport.makeAppliedOperationResultsData(operations: operations)
                return (response, data)
            }

            let data = url.path.hasSuffix("/sync/pull")
                ? CloudSupportTestSupport.emptySyncPullResponseData()
                : CloudSupportTestSupport.emptyReviewHistoryPullResponseData()
            return (response, data)
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)

        _ = try await Task.detached {
            try await service.runLinkedSync(
                linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
            )
        }.value

        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
    }

    // MARK: - Review History

    /// Guards the dedicated `/sync/review-history/pull` lane request and response.
    @MainActor
    func testRunLinkedSyncReviewHistoryPullRequestIncludesCursorAndAppliesBackendResponse() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)
        let savedCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CloudSupportTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map(\.operationId))

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        CloudSupportTestSupport.setRequestHandler { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/pull") {
                return (response, CloudSupportTestSupport.emptySyncPullResponseData())
            }

            let bodyObject = try CloudSupportTestSupport.requestBodyObject(request: request)
            XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
            XCTAssertEqual(bodyObject["platform"] as? String, "ios")
            XCTAssertEqual(bodyObject["afterReviewSequenceId"] as? Int64, 44)
            XCTAssertEqual(bodyObject["limit"] as? Int, 200)

            let data = """
            {"reviewEvents":[{"reviewEventId":"remote-review-1","workspaceId":"\(workspaceId)","cardId":"\(savedCard.cardId)","deviceId":"remote-device","clientEventId":"remote-client-event","rating":2,"reviewedAtClient":"2026-03-09T10:00:00.000Z","reviewedAtServer":"2026-03-09T10:00:01.000Z"}],"nextReviewSequenceId":45,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = self.makeService(database: database)
        try CloudSupportTestSupport.prepareHydratedSyncState(database: database, workspaceId: workspaceId)
        try database.setLastAppliedReviewSequenceId(workspaceId: workspaceId, reviewSequenceId: 44)

        _ = try await service.runLinkedSync(
            linkedSession: CloudSupportTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.count, 1)
        XCTAssertEqual(reviewEvents[0].reviewEventId, "remote-review-1")
        XCTAssertEqual(try database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId), 45)
    }

    private func makeService(database: LocalDatabase) -> CloudSyncService {
        CloudSyncService(database: database, session: CloudSupportTestSupport.makeSession())
    }
}
