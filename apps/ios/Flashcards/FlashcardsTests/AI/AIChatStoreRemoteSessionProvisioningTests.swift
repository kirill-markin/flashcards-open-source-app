import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningTests: XCTestCase {
    func testStartLinkedBootstrapCreatesExplicitSessionBeforeBootstrapForLinkedSession() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
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
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
    }

    func testStartLinkedBootstrapCreatesExplicitSessionBeforeBootstrapForGuestSession() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap load.")
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
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
    }

    func testFirstSendUsesExplicitSessionWithoutSnapshotRecovery() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = ""
        store.conversationScopeId = ""
        store.inputText = "Help me review this."
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before the first send.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id in the first send request.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: "Help me review this."
            )
        }

        store.sendMessage()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.startRunRequests.map(\.sessionId), [explicitSessionId])
        XCTAssertTrue(context.chatService.loadSnapshotSessionIds.isEmpty)
        XCTAssertNil(store.activeSendTask)
        XCTAssertNil(store.activeAlert)
    }

    func testFirstSendFromSessionlessStateRestoresDraftAcrossRestartBeforeAcceptance() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let syncGate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = syncGate
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = ""
        store.conversationScopeId = ""

        let expectedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: []
        )
        store.inputText = expectedDraft.inputText

        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before provisioning.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id while starting the run.")
            }

            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: expectedDraft.inputText
            )
        }

        store.sendMessage()

        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)

        let didPersistExplicitSessionDraft = await AIChatStoreTestSupport.waitForCondition(
            description: "sessionless pre-accept draft persisted under explicit session id",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                let persistedState = context.historyStore.loadState()
                guard persistedState.chatSessionId.isEmpty == false else {
                    return false
                }

                return persistedState.requiresRemoteSessionProvisioning
                    && context.historyStore.loadDraft(
                        workspaceId: store.historyWorkspaceId(),
                        sessionId: persistedState.chatSessionId
                    ) == expectedDraft
            }
        )
        XCTAssertTrue(didPersistExplicitSessionDraft)

        let explicitSessionId = context.historyStore.loadState().chatSessionId
        let restartedBeforeAcceptance = context.makeStore()

        XCTAssertEqual(restartedBeforeAcceptance.chatSessionId, explicitSessionId)
        XCTAssertEqual(restartedBeforeAcceptance.conversationScopeId, explicitSessionId)
        XCTAssertEqual(restartedBeforeAcceptance.inputText, expectedDraft.inputText)
        XCTAssertTrue(restartedBeforeAcceptance.pendingAttachments.isEmpty)
        XCTAssertTrue(restartedBeforeAcceptance.requiresRemoteSessionProvisioning)

        store.activeSendTask?.cancel()
        await syncGate.release()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
    }

    func testAcceptedFirstSendFromSessionlessStateClearsDraftDurably() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        store.chatSessionId = ""
        store.conversationScopeId = ""
        store.activeConversationId = "conversation-1"

        let expectedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: []
        )
        store.inputText = expectedDraft.inputText
        let explicitSessionId = "session-explicit"

        store.prepareExplicitRemoteSessionProvisioning(sessionId: explicitSessionId)
        store.persistStateSynchronously(state: store.currentPersistedState())

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                    sessionId: explicitSessionId,
                    userText: expectedDraft.inputText
                )
            ),
            conversationId: "conversation-1"
        )
        await store.waitForPendingStatePersistence()

        XCTAssertFalse(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: explicitSessionId
            ),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )

        let restartedAfterAcceptance = context.makeStore()

        XCTAssertEqual(restartedAfterAcceptance.chatSessionId, explicitSessionId)
        XCTAssertEqual(restartedAfterAcceptance.inputText, "")
        XCTAssertTrue(restartedAfterAcceptance.pendingAttachments.isEmpty)
        XCTAssertFalse(restartedAfterAcceptance.requiresRemoteSessionProvisioning)
        XCTAssertEqual(
            restartedAfterAcceptance.messages,
            AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: explicitSessionId,
                userText: expectedDraft.inputText
            ).envelope.conversation.messages
        )
    }

    func testFirstDictationUsesExplicitSessionId() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let voiceRecorder = AIChatStoreTestSupport.TestVoiceRecorder()
        let transcriber = AIChatStoreTestSupport.TestAudioTranscriber()
        let store = context.makeStore(
            voiceRecorder: voiceRecorder,
            audioTranscriber: transcriber
        )
        store.acceptExternalProviderConsent()
        store.chatSessionId = ""
        store.conversationScopeId = ""
        store.dictationState = .recording
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before the first dictation.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }

        store.finishDictation()
        await AIChatStoreTestSupport.waitForDictationToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        let transcribedSessionIds = await transcriber.transcribedSessionIds()
        XCTAssertEqual(transcribedSessionIds, [explicitSessionId])
        XCTAssertNil(store.activeAlert)
    }

    func testRemoteSessionProvisioningRetryReusesSameExplicitSessionId() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        var createAttempts = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id for retry coverage.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            createAttempts += 1
            if createAttempts == 1 {
                throw LocalStoreError.validation("Transient AI chat provisioning failure.")
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }

        store.startFreshLocalSession(
            inputText: "",
            pendingAttachments: []
        )
        await AIChatStoreTestSupport.waitForNewSessionToSettle(store: store)

        let explicitSessionId = store.chatSessionId
        XCTAssertFalse(explicitSessionId.isEmpty)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)

        let retriedSessionId = try await store.ensureRemoteSessionIfNeeded()

        XCTAssertEqual(retriedSessionId, explicitSessionId)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertFalse(store.requiresRemoteSessionProvisioning)
    }
}
