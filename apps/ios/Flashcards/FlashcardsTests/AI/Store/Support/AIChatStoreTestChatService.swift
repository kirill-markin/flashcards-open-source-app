@testable import Flashcards


extension AIChatStoreTestSupport {
    final class ChatService: AIChatSessionServicing, @unchecked Sendable {
        var events: [String]
        var loadSnapshotSessionIds: [String?]
        var loadBootstrapSessionIds: [String?]
        var loadBootstrapGate: AsyncGate?
        var startRunRequests: [AIChatStartRunRequestBody]
        var createNewSessionRequests: [AIChatNewSessionRequestBody]
        var stopRunRequests: [(sessionId: String, runId: String?, workspaceId: String, authorizationHeader: String)]
        var stopRunGate: AsyncGate?
        var loadBootstrapHandler: ((String?) throws -> AIChatBootstrapResponse)?
        var startRunHandler: ((AIChatStartRunRequestBody) throws -> AIChatStartRunResponse)?
        var createNewSessionHandler: ((AIChatNewSessionRequestBody) throws -> AIChatNewSessionResponse)?
        var stopRunHandler: ((String, String?) throws -> AIChatStopRunResponse)?

        var createNewSessionSessionIds: [String?] {
            self.createNewSessionRequests.map(\.sessionId)
        }

        init() {
            self.events = []
            self.loadSnapshotSessionIds = []
            self.loadBootstrapSessionIds = []
            self.loadBootstrapGate = nil
            self.startRunRequests = []
            self.createNewSessionRequests = []
            self.stopRunRequests = []
            self.stopRunGate = nil
            self.loadBootstrapHandler = nil
            self.startRunHandler = nil
            self.createNewSessionHandler = nil
            self.stopRunHandler = nil
        }

        func loadSnapshot(
            session: CloudLinkedSession,
            sessionId: String?
        ) async throws -> AIChatSessionSnapshot {
            _ = session
            self.events.append("loadSnapshot:\(sessionId ?? "nil")")
            self.loadSnapshotSessionIds.append(sessionId)
            throw LocalStoreError.validation("Unexpected AI chat snapshot request in tests.")
        }

        func loadBootstrap(
            session: CloudLinkedSession,
            sessionId: String?,
            limit: Int,
            resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
        ) async throws -> AIChatBootstrapResponse {
            _ = session
            _ = limit
            _ = resumeAttemptDiagnostics
            self.events.append("loadBootstrap:\(sessionId ?? "nil")")
            self.loadBootstrapSessionIds.append(sessionId)
            if let loadBootstrapGate = self.loadBootstrapGate {
                await loadBootstrapGate.wait()
            }
            guard let loadBootstrapHandler else {
                throw LocalStoreError.validation("Unexpected AI chat bootstrap request in tests.")
            }
            return try loadBootstrapHandler(sessionId)
        }

        func loadOlderMessages(
            session: CloudLinkedSession,
            sessionId: String,
            beforeCursor: String,
            limit: Int
        ) async throws -> AIChatOlderMessagesResponse {
            _ = session
            _ = sessionId
            _ = beforeCursor
            _ = limit
            throw LocalStoreError.validation("Unexpected AI chat older-messages request in tests.")
        }

        func startRun(
            session: CloudLinkedSession,
            request: AIChatStartRunRequestBody
        ) async throws -> AIChatStartRunResponse {
            _ = session
            self.events.append("startRun:\(request.sessionId ?? "nil")")
            self.startRunRequests.append(request)
            guard let startRunHandler else {
                throw LocalStoreError.validation("Unexpected AI chat start-run request in tests.")
            }
            return try startRunHandler(request)
        }

        func createNewSession(
            session: CloudLinkedSession,
            request: AIChatNewSessionRequestBody
        ) async throws -> AIChatNewSessionResponse {
            _ = session
            self.events.append("createNewSession:\(request.sessionId ?? "nil")")
            self.createNewSessionRequests.append(request)
            guard let createNewSessionHandler else {
                throw LocalStoreError.validation("Unexpected AI chat new-session request in tests.")
            }
            return try createNewSessionHandler(request)
        }

        func stopRun(
            session: CloudLinkedSession,
            sessionId: String,
            runId: String?
        ) async throws -> AIChatStopRunResponse {
            self.events.append("stopRun:\(sessionId):\(runId ?? "nil")")
            self.stopRunRequests.append((
                sessionId: sessionId,
                runId: runId,
                workspaceId: session.workspaceId,
                authorizationHeader: session.authorizationHeaderValue
            ))
            if let stopRunGate = self.stopRunGate {
                await stopRunGate.wait()
                self.stopRunGate = nil
            }
            if let stopRunHandler {
                return try stopRunHandler(sessionId, runId)
            }
            return AIChatStopRunResponse(
                sessionId: sessionId,
                stopped: true,
                stillRunning: false
            )
        }
    }
}
