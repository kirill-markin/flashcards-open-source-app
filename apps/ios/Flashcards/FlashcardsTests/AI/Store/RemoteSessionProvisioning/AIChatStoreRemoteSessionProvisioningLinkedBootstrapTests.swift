import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningLinkedBootstrapTests: XCTestCase {
    func testLinkedBootstrapRetryReusesSameExplicitSessionIdBeforeLoadingBootstrap() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        var createAttempts: Int = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            createAttempts += 1
            if createAttempts == 1 {
                throw URLError(.networkConnectionLost)
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap load.")
            }
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "createNewSession:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }

    func testSupersededLinkedBootstrapCannotApplyStaleResponse() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let staleBootstrapGate = AIChatStoreTestSupport.AsyncGate()
        context.chatService.loadBootstrapGate = staleBootstrapGate
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap.")
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        var servedBootstrapResponseCount: Int = 0
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap load.")
            }
            servedBootstrapResponseCount += 1
            let messageText = servedBootstrapResponseCount == 1
                ? "Fresh bootstrap response"
                : "Stale bootstrap response"
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [
                    AIChatStoreTestSupport.makeAssistantTextMessage(
                        id: "message-\(servedBootstrapResponseCount)",
                        itemId: "item-\(servedBootstrapResponseCount)",
                        text: messageText,
                        timestamp: "2026-04-08T10:00:00Z"
                    )
                ],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)

        let didStartStaleBootstrap = await AIChatStoreTestSupport.waitForCondition(
            description: "first linked bootstrap reached loadBootstrap",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.loadBootstrapSessionIds.count == 1
            }
        )
        XCTAssertTrue(didStartStaleBootstrap)

        context.chatService.loadBootstrapGate = nil
        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(servedBootstrapResponseCount, 1)
        XCTAssertEqual(store.messages.map(\.content), [[.text("Fresh bootstrap response")]])

        await staleBootstrapGate.release()

        let didServeStaleBootstrap = await AIChatStoreTestSupport.waitForCondition(
            description: "superseded linked bootstrap completed",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                servedBootstrapResponseCount == 2
            }
        )
        XCTAssertTrue(didServeStaleBootstrap)
        XCTAssertNil(store.activeBootstrapTask)
        XCTAssertEqual(store.messages.map(\.content), [[.text("Fresh bootstrap response")]])
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }

    func testLinkedBootstrapRetriesTransientCloudSessionSetupBeforeProvisioning() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        context.flashcardsStore.cloudRuntime.disconnectSession()
        context.cloudSyncService.runLinkedSyncErrors = [URLError(.timedOut)]
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id after session setup retry.")
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap load.")
            }
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [explicitSessionId])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }

    func testFailedCloudSessionSetupClearsRefreshedActiveSessionForRetry() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let failedSession = try XCTUnwrap(context.flashcardsStore.cloudRuntime.activeCloudSession())
        let refreshedSession = try context.flashcardsStore.cloudRuntime.sessionWithUpdatedBearerToken(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token-1",
                idToken: "token-2",
                idTokenExpiresAt: "2099-01-01T00:00:00Z"
            )
        )

        XCTAssertNotEqual(refreshedSession, failedSession)
        context.flashcardsStore.cloudRuntime.clearActiveCloudSessionIfMatchingStableContext(
            linkedSession: failedSession
        )

        XCTAssertNil(context.flashcardsStore.cloudRuntime.activeCloudSession())
    }

}
