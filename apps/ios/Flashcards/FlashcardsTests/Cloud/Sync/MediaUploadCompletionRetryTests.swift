import CryptoKit
import Foundation
import XCTest
@testable import Flashcards

final class MediaUploadCompletionRetryTests: LocalWorkspaceSyncTestCase {
    override func tearDownWithError() throws {
        CloudSyncRunnerTestURLProtocol.reset()
        try super.tearDownWithError()
    }

    func testCompletionTransportPreservesRetryAfterDelay() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let transport = CloudSyncTransport(
            session: URLSession(configuration: configuration),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 503,
                    httpVersion: nil,
                    headerFields: [
                        "Content-Type": "application/json",
                        "Retry-After": "2",
                    ]
                )
            )
            return (
                response,
                Data(
                    """
                    {
                      "error": "Completion is still being applied",
                      "code": "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                      "requestId": "completion-request-1"
                    }
                    """.utf8
                )
            )
        }

        do {
            _ = try await transport.completeMediaAssetUploadSession(
                apiBaseUrl: "https://api.example.test/v1",
                authorizationHeader: "Bearer token",
                workspaceId: workspaceId,
                sessionId: sessionId,
                requestBody: MediaAssetUploadSessionCompleteRequest(
                    parts: [
                        CompletedMediaAssetUploadPart(
                            partNumber: 1,
                            eTag: "\"etag-1\"",
                            sha256: helloWorldSha256
                        )
                    ]
                )
            )
            XCTFail("Expected completion failure")
        } catch let error as CloudSyncError {
            guard case .invalidResponse(let details, _) = error else {
                XCTFail("Expected invalid response, got \(error)")
                return
            }
            XCTAssertEqual(details.code, "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS")
            XCTAssertEqual(details.retryAfterDelayNanoseconds, 2_000_000_000)
        }
    }

    @MainActor
    func testRunnerRetriesOnlyCompletionAndAcceptsSameSessionReplay() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
                .success(applied: false, mutateClaim: false),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId, sessionId, sessionId])
        XCTAssertEqual(snapshot.completeBodies.count, 3)
        XCTAssertTrue(snapshot.completeBodies.allSatisfy { body in body == snapshot.completeBodies.first })
        let completionRequest = try JSONDecoder().decode(
            MediaUploadCompletionTestRequest.self,
            from: try XCTUnwrap(snapshot.completeBodies.first)
        )
        XCTAssertEqual(
            completionRequest.parts,
            [
                MediaUploadCompletionTestPart(
                    partNumber: 1,
                    eTag: "\"etag-1\"",
                    sha256: helloWorldSha256
                )
            ]
        )
        XCTAssertEqual(snapshot.abortCount, 0)
        XCTAssertEqual(try self.loadTransferState(database: context.database).status, "succeeded")
    }

    @MainActor
    func testRunnerMarksCompletionRetryExhaustionTerminalWithoutRestartOrAbort() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let exhaustedSnapshot = context.recorder.snapshot()
        XCTAssertEqual(exhaustedSnapshot.createCount, 1)
        XCTAssertEqual(exhaustedSnapshot.partPutCount, 1)
        XCTAssertEqual(exhaustedSnapshot.completeSessionIds, Array(repeating: sessionId, count: cloudSyncTransportMaxAttempts))
        XCTAssertEqual(exhaustedSnapshot.abortCount, 0)
        let exhaustedState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(exhaustedState.status, "failed")
        XCTAssertEqual(exhaustedState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(exhaustedState.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS") == true)

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )
        XCTAssertEqual(context.recorder.snapshot(), exhaustedSnapshot)
    }

    @MainActor
    func testRunnerCancellationDuringCompletionBackoffIsTerminalWithoutAbort() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 60,
                    mutateClaim: false
                ),
            ]
        )
        let runnerTask = Task {
            try await context.runner.processDueUploads(
                linkedSession: context.linkedSession,
                now: Date()
            )
        }

        try await self.waitForCompletionRequest(recorder: context.recorder)
        runnerTask.cancel()
        do {
            try await runnerTask.value
            XCTFail("Expected the cancelled upload runner to stop")
        } catch {
            XCTAssertTrue(isRequestCancellationError(error: error))
        }

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId])
        XCTAssertEqual(snapshot.abortCount, 0)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
    }

    @MainActor
    func testRunnerClaimLossDuringBackoffStopsBeforeReplayWithoutAbortOrRestart() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 0,
                    mutateClaim: true
                ),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId])
        XCTAssertEqual(snapshot.abortCount, 0)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(transferState.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS") == true)

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )
        XCTAssertEqual(context.recorder.snapshot(), snapshot)
    }

    @MainActor
    func testRunnerClaimLossDuringReplaySuccessIsTerminalWithoutAbortOrRestart() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
                .success(applied: false, mutateClaim: true),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId, sessionId])
        XCTAssertEqual(snapshot.abortCount, 0)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(transferState.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS") == true)

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )
        XCTAssertEqual(context.recorder.snapshot(), snapshot)
    }

    @MainActor
    func testRunnerTerminalizesLaterTerminalResponseAfterDurableCompletionBegins() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
                .terminal(code: "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH"),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId, sessionId])
        XCTAssertEqual(snapshot.abortCount, 0)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(transferState.lastError?.contains(
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS"
        ) == true)
        XCTAssertTrue(transferState.lastError?.contains("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH") == true)

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )
        XCTAssertEqual(context.recorder.snapshot(), snapshot)
    }

    @MainActor
    func testRunnerTerminalizesInvalidReplayAssetAfterDurableCompletionBegins() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .retryable(
                    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
                    retryAfterSeconds: 0,
                    mutateClaim: false
                ),
                .invalidSuccess,
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId, sessionId])
        XCTAssertEqual(snapshot.abortCount, 0)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(transferState.lastError?.contains(
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED"
        ) == true)
        XCTAssertTrue(transferState.lastError?.contains("completed asset identity mismatch") == true)

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )
        XCTAssertEqual(context.recorder.snapshot(), snapshot)
    }

    @MainActor
    func testRunnerAbortsTerminalCompletionFailure() async throws {
        let context = try self.makeRunnerContext(
            completionOutcomes: [
                .terminal(code: "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH"),
            ]
        )

        try await context.runner.processDueUploads(
            linkedSession: context.linkedSession,
            now: Date()
        )

        let snapshot = context.recorder.snapshot()
        XCTAssertEqual(snapshot.createCount, 1)
        XCTAssertEqual(snapshot.partPutCount, 1)
        XCTAssertEqual(snapshot.completeSessionIds, [sessionId])
        XCTAssertEqual(snapshot.abortCount, 1)
        let transferState = try self.loadTransferState(database: context.database)
        XCTAssertEqual(transferState.status, "failed")
        XCTAssertEqual(transferState.nextAttemptAt, mediaUploadPermanentFailureNextAttemptAt)
        XCTAssertTrue(transferState.lastError?.contains("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH") == true)
    }

    @MainActor
    private func makeRunnerContext(
        completionOutcomes: [MediaUploadCompletionTestOutcome]
    ) throws -> MediaUploadRunnerTestContext {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let mediaBytes = Data("hello world".utf8)
        let sha256 = SHA256.hash(data: mediaBytes).map { byte in
            String(format: "%02x", byte)
        }.joined()
        XCTAssertEqual(sha256, helloWorldSha256)
        let transfer = try database.mediaTransferStore.enqueueTransfer(
            request: MediaTransferEnqueueRequest(
                transferId: transferId,
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAssetId,
                kind: .upload,
                sha256: sha256,
                mimeType: "text/plain",
                sizeBytes: Int64(mediaBytes.count),
                createdAt: createdAt
            )
        )
        let cacheURL = database.databaseURL
            .deletingLastPathComponent()
            .appendingPathComponent(transfer.localRelativePath, isDirectory: false)
        try FileManager.default.createDirectory(
            at: cacheURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try mediaBytes.write(to: cacheURL, options: [.atomic])

        let installationId = try database.loadBootstrapSnapshot().cloudSettings.installationId
        let recorder = MediaUploadRunnerRequestRecorder(
            workspaceId: workspace.workspaceId,
            mediaAssetId: mediaAssetId,
            sha256: sha256,
            lastModifiedByReplicaId: mediaUploadWorkspaceReplicaId(
                workspaceId: workspace.workspaceId,
                installationId: installationId
            ),
            completionOutcomes: completionOutcomes,
            mutateClaim: {
                _ = try database.core.execute(
                    sql: """
                    UPDATE media_transfer_queue
                    SET claimed_at = ?
                    WHERE transfer_id = ?
                    """,
                    values: [
                        .text("2099-01-01T00:00:00.000Z"),
                        .text(Self.transferId)
                    ]
                )
            }
        )
        CloudSyncRunnerTestURLProtocol.requestHandler = { request in
            try recorder.handle(request: request)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSyncRunnerTestURLProtocol.self]
        let service = CloudSyncService(
            database: database,
            session: URLSession(configuration: configuration)
        )
        let linkedSession = self.makeLinkedSession(workspaceId: workspace.workspaceId)
        return MediaUploadRunnerTestContext(
            database: database,
            linkedSession: linkedSession,
            recorder: recorder,
            runner: MediaUploadTransferRunner(
                database: database,
                cloudSyncService: service
            )
        )
    }

    private func loadTransferState(database: LocalDatabase) throws -> MediaUploadTransferTestState {
        let rows = try database.core.query(
            sql: """
            SELECT status, next_attempt_at, last_error
            FROM media_transfer_queue
            WHERE transfer_id = ?
            LIMIT 1
            """,
            values: [.text(transferId)]
        ) { statement in
            MediaUploadTransferTestState(
                status: DatabaseCore.columnText(statement: statement, index: 0),
                nextAttemptAt: DatabaseCore.columnOptionalText(statement: statement, index: 1),
                lastError: DatabaseCore.columnOptionalText(statement: statement, index: 2)
            )
        }
        return try XCTUnwrap(rows.first)
    }

    @MainActor
    private func waitForCompletionRequest(recorder: MediaUploadRunnerRequestRecorder) async throws {
        for _ in 0..<100 {
            if recorder.snapshot().completeSessionIds.isEmpty == false {
                return
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Timed out waiting for the first completion request")
    }

    fileprivate static let workspaceId = "11111111-1111-4111-8111-111111111111"
    fileprivate static let mediaAssetId = "22222222-2222-4222-8222-222222222222"
    fileprivate static let sessionId = "55555555-5555-4555-8555-555555555555"
    fileprivate static let transferId = "media-upload-transfer-1"
    fileprivate static let createdAt = "2026-03-10T09:00:00.000Z"
    fileprivate static let helloWorldSha256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"

    private var workspaceId: String { Self.workspaceId }
    private var mediaAssetId: String { Self.mediaAssetId }
    private var sessionId: String { Self.sessionId }
    private var transferId: String { Self.transferId }
    private var createdAt: String { Self.createdAt }
    private var helloWorldSha256: String { Self.helloWorldSha256 }
}

private struct MediaUploadRunnerTestContext {
    let database: LocalDatabase
    let linkedSession: CloudLinkedSession
    let recorder: MediaUploadRunnerRequestRecorder
    let runner: MediaUploadTransferRunner
}

private struct MediaUploadTransferTestState {
    let status: String
    let nextAttemptAt: String?
    let lastError: String?
}

private enum MediaUploadCompletionTestOutcome {
    case retryable(code: String, retryAfterSeconds: Int, mutateClaim: Bool)
    case success(applied: Bool, mutateClaim: Bool)
    case invalidSuccess
    case terminal(code: String)

    var mutatesClaim: Bool {
        switch self {
        case .retryable(_, _, let mutateClaim), .success(_, let mutateClaim):
            return mutateClaim
        case .invalidSuccess, .terminal:
            return false
        }
    }
}

private struct MediaUploadCompletionTestRequest: Decodable {
    let parts: [MediaUploadCompletionTestPart]
}

private struct MediaUploadCompletionTestPart: Decodable, Equatable {
    let partNumber: Int
    let eTag: String
    let sha256: String
}

private struct MediaUploadRunnerRequestSnapshot: Equatable {
    let createCount: Int
    let partPutCount: Int
    let completeSessionIds: [String]
    let completeBodies: [Data]
    let abortCount: Int
}

private final class MediaUploadRunnerRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private let workspaceId: String
    private let mediaAssetId: String
    private let sha256: String
    private let lastModifiedByReplicaId: String
    private let completionOutcomes: [MediaUploadCompletionTestOutcome]
    private let mutateClaim: () throws -> Void
    private var createCount = 0
    private var partPutCount = 0
    private var completeSessionIds: [String] = []
    private var completeBodies: [Data] = []
    private var abortCount = 0

    init(
        workspaceId: String,
        mediaAssetId: String,
        sha256: String,
        lastModifiedByReplicaId: String,
        completionOutcomes: [MediaUploadCompletionTestOutcome],
        mutateClaim: @escaping () throws -> Void
    ) {
        self.workspaceId = workspaceId
        self.mediaAssetId = mediaAssetId
        self.sha256 = sha256
        self.lastModifiedByReplicaId = lastModifiedByReplicaId
        self.completionOutcomes = completionOutcomes
        self.mutateClaim = mutateClaim
        precondition(completionOutcomes.isEmpty == false)
    }

    func handle(request: URLRequest) throws -> (HTTPURLResponse, Data) {
        let url = try XCTUnwrap(request.url)
        let path = url.path

        if request.httpMethod == "POST", path.hasSuffix("/media-assets/upload-sessions") {
            self.lock.lock()
            self.createCount += 1
            self.lock.unlock()
            return try self.jsonResponse(
                url: url,
                statusCode: 201,
                headers: [:],
                body: """
                {
                  "workspaceId": "\(self.workspaceId)",
                  "mediaAssetId": "\(self.mediaAssetId)",
                  "status": "upload_required",
                  "mediaAsset": null,
                  "uploadSession": {
                    "sessionId": "\(MediaUploadCompletionRetryTests.sessionId)",
                    "expiresAt": "9999-12-31T23:59:59.999Z",
                    "partSizeBytes": 8388608,
                    "partCount": 1
                  }
                }
                """
            )
        }

        if request.httpMethod == "POST", path.hasSuffix("/\(MediaUploadCompletionRetryTests.sessionId)/parts") {
            return try self.jsonResponse(
                url: url,
                statusCode: 200,
                headers: [:],
                body: """
                {
                  "sessionId": "\(MediaUploadCompletionRetryTests.sessionId)",
                  "partUrls": [{
                    "partNumber": 1,
                    "method": "PUT",
                    "url": "https://uploads.example.test/part-1",
                    "expiresAt": "9999-12-31T23:59:59.999Z",
                    "headers": {}
                  }]
                }
                """
            )
        }

        if request.httpMethod == "PUT", url.host == "uploads.example.test" {
            self.lock.lock()
            self.partPutCount += 1
            self.lock.unlock()
            return try self.jsonResponse(
                url: url,
                statusCode: 200,
                headers: ["ETag": "\"etag-1\""],
                body: ""
            )
        }

        if request.httpMethod == "POST", path.hasSuffix("/\(MediaUploadCompletionRetryTests.sessionId)/complete") {
            let body = try Self.requestBodyData(request: request)
            self.lock.lock()
            self.completeSessionIds.append(MediaUploadCompletionRetryTests.sessionId)
            self.completeBodies.append(body)
            let outcomeIndex = self.completeSessionIds.count - 1
            let outcome = self.completionOutcomes[min(outcomeIndex, self.completionOutcomes.count - 1)]
            self.lock.unlock()
            if outcome.mutatesClaim {
                try self.mutateClaim()
            }
            return try self.completionResponse(url: url, outcome: outcome)
        }

        if request.httpMethod == "POST", path.hasSuffix("/\(MediaUploadCompletionRetryTests.sessionId)/abort") {
            self.lock.lock()
            self.abortCount += 1
            self.lock.unlock()
            return try self.jsonResponse(
                url: url,
                statusCode: 200,
                headers: [:],
                body: """
                {
                  "sessionId": "\(MediaUploadCompletionRetryTests.sessionId)",
                  "abortedAt": "2026-03-10T09:00:05.000Z"
                }
                """
            )
        }

        throw URLError(.unsupportedURL)
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

    func snapshot() -> MediaUploadRunnerRequestSnapshot {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return MediaUploadRunnerRequestSnapshot(
            createCount: self.createCount,
            partPutCount: self.partPutCount,
            completeSessionIds: self.completeSessionIds,
            completeBodies: self.completeBodies,
            abortCount: self.abortCount
        )
    }

    private func completionResponse(
        url: URL,
        outcome: MediaUploadCompletionTestOutcome
    ) throws -> (HTTPURLResponse, Data) {
        switch outcome {
        case .retryable(let code, let retryAfterSeconds, _):
            return try self.jsonResponse(
                url: url,
                statusCode: 503,
                headers: ["Retry-After": String(retryAfterSeconds)],
                body: """
                {
                  "error": "Completion is still being applied",
                  "code": "\(code)",
                  "requestId": "completion-request-1"
                }
                """
            )
        case .success(let applied, _):
            return try self.jsonResponse(
                url: url,
                statusCode: 200,
                headers: [:],
                body: """
                {
                  "mediaAsset": {
                    "mediaAssetId": "\(self.mediaAssetId)",
                    "workspaceId": "\(self.workspaceId)",
                    "mimeType": "text/plain",
                    "sizeBytes": 11,
                    "sha256": "\(self.sha256)",
                    "sourceUrl": null,
                    "createdAt": "\(MediaUploadCompletionRetryTests.createdAt)",
                    "clientUpdatedAt": "\(MediaUploadCompletionRetryTests.createdAt)",
                    "lastModifiedByReplicaId": "\(self.lastModifiedByReplicaId)",
                    "lastOperationId": "\(MediaUploadCompletionRetryTests.transferId)",
                    "updatedAt": "2026-03-10T09:00:01.000Z",
                    "deletedAt": null
                  },
                  "applied": \(applied)
                }
                """
            )
        case .invalidSuccess:
            return try self.jsonResponse(
                url: url,
                statusCode: 200,
                headers: [:],
                body: """
                {
                  "mediaAsset": {
                    "mediaAssetId": "77777777-7777-4777-8777-777777777777",
                    "workspaceId": "\(self.workspaceId)",
                    "mimeType": "text/plain",
                    "sizeBytes": 11,
                    "sha256": "\(self.sha256)",
                    "sourceUrl": null,
                    "createdAt": "\(MediaUploadCompletionRetryTests.createdAt)",
                    "clientUpdatedAt": "\(MediaUploadCompletionRetryTests.createdAt)",
                    "lastModifiedByReplicaId": "\(self.lastModifiedByReplicaId)",
                    "lastOperationId": "\(MediaUploadCompletionRetryTests.transferId)",
                    "updatedAt": "2026-03-10T09:00:01.000Z",
                    "deletedAt": null
                  },
                  "applied": false
                }
                """
            )
        case .terminal(let code):
            return try self.jsonResponse(
                url: url,
                statusCode: 400,
                headers: [:],
                body: """
                {
                  "error": "Completion payload is invalid",
                  "code": "\(code)",
                  "requestId": "completion-request-terminal"
                }
                """
            )
        }
    }

    private func jsonResponse(
        url: URL,
        statusCode: Int,
        headers: [String: String],
        body: String
    ) throws -> (HTTPURLResponse, Data) {
        var responseHeaders = headers
        responseHeaders["Content-Type"] = "application/json"
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: statusCode,
                httpVersion: nil,
                headerFields: responseHeaders
            )
        )
        return (response, Data(body.utf8))
    }
}
