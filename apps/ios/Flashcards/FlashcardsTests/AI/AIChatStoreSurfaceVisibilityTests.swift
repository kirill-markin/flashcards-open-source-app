import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreSurfaceVisibilityTests: XCTestCase {
    func testStartFreshLocalSessionKeepsLiveAttachEnabledWhileAISurfaceIsVisible() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.updateSurface(
            activity: AIChatSurfaceActivity(
                isSceneActive: true,
                isAITabSelected: true,
                hasExternalProviderConsent: true,
                workspaceId: context.flashcardsStore.workspace?.workspaceId,
                cloudState: context.flashcardsStore.cloudSettings?.cloudState,
                linkedUserId: context.flashcardsStore.cloudSettings?.linkedUserId,
                activeWorkspaceId: context.flashcardsStore.cloudSettings?.activeWorkspaceId
            )
        )

        XCTAssertTrue(store.shouldKeepLiveAttached)

        store.startFreshLocalSession(
            inputText: "",
            pendingAttachments: []
        )

        XCTAssertTrue(store.shouldKeepLiveAttached)
    }

    func testVisibleSurfaceRestartsRetryableBootstrapFailure() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let visibleActivity = self.makeLinkedSurfaceActivity(context: context, isVisible: true)
        let hiddenActivity = self.makeLinkedSurfaceActivity(context: context, isVisible: false)
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during initial bootstrap.")
            }

            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.updateSurface(activity: visibleActivity)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(store.surfaceState.activeAccessContext, visibleActivity.accessContext)
        XCTAssertEqual(store.bootstrapPhase, .ready)
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])

        context.chatService.loadBootstrapHandler = { sessionId in
            guard sessionId == explicitSessionId else {
                throw LocalStoreError.validation("Expected failed bootstrap to reuse the active session id.")
            }

            throw URLError(.networkConnectionLost)
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        guard case .failed = store.bootstrapPhase else {
            XCTFail("Expected retryable bootstrap failure before visible-surface recovery.")
            return
        }

        store.updateSurface(activity: hiddenActivity)
        context.chatService.loadBootstrapHandler = { sessionId in
            guard sessionId == explicitSessionId else {
                throw LocalStoreError.validation("Expected bootstrap recovery to reuse the failed session id.")
            }

            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: explicitSessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.updateSurface(activity: visibleActivity)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(store.bootstrapPhase, .ready)
        XCTAssertFalse(store.lastBootstrapFailureWasRetryable)
    }

    func testVisibleSurfaceDoesNotRestartPermanentBootstrapFailure() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let visibleActivity = self.makeLinkedSurfaceActivity(context: context, isVisible: true)
        let hiddenActivity = self.makeLinkedSurfaceActivity(context: context, isVisible: false)
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during initial bootstrap.")
            }

            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.updateSurface(activity: visibleActivity)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(store.surfaceState.activeAccessContext, visibleActivity.accessContext)
        XCTAssertEqual(store.bootstrapPhase, .ready)
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])

        context.chatService.loadBootstrapHandler = { _ in
            throw LocalStoreError.validation("Permanent bootstrap validation failure.")
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        guard case .failed = store.bootstrapPhase else {
            XCTFail("Expected permanent bootstrap failure before visible-surface sync.")
            return
        }

        store.updateSurface(activity: hiddenActivity)
        context.chatService.loadBootstrapHandler = { _ in
            XCTFail("Permanent bootstrap failures should not be restarted by surface visibility.")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: explicitSessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.updateSurface(activity: visibleActivity)

        XCTAssertNil(store.activeBootstrapTask)
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        guard case .failed = store.bootstrapPhase else {
            XCTFail("Expected permanent bootstrap failure to remain visible.")
            return
        }
    }

    private func makeLinkedSurfaceActivity(
        context: AIChatStoreTestSupport.Context,
        isVisible: Bool
    ) -> AIChatSurfaceActivity {
        AIChatSurfaceActivity(
            isSceneActive: isVisible,
            isAITabSelected: isVisible,
            hasExternalProviderConsent: true,
            workspaceId: context.flashcardsStore.workspace?.workspaceId,
            cloudState: context.flashcardsStore.cloudSettings?.cloudState,
            linkedUserId: context.flashcardsStore.cloudSettings?.linkedUserId,
            activeWorkspaceId: context.flashcardsStore.cloudSettings?.activeWorkspaceId
        )
    }
}
