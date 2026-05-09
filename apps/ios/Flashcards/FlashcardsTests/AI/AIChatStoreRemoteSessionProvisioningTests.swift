import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningTests: XCTestCase {
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

    func testLinkedBootstrapDoesNotRetryTransientCloudSessionSetupBeforeProvisioning() async throws {
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

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(context.chatService.events.isEmpty)
        XCTAssertTrue(context.chatService.createNewSessionSessionIds.isEmpty)
        XCTAssertTrue(context.chatService.loadBootstrapSessionIds.isEmpty)
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected bootstrap failure without retrying cloud session setup.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
    }

    func testGuestBootstrapRetryReusesSameExplicitSessionIdBeforeLoadingBootstrap() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        var createAttempts: Int = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap.")
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

    func testLinkedBootstrapSessionContractMismatchFailsClosedWithoutRetrying() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before bootstrap validation.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let requestedSessionId = sessionId, requestedSessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap validation.")
            }

            return makeBootstrapResponse(
                sessionId: "wrong-\(requestedSessionId)",
                conversationScopeId: "wrong-\(requestedSessionId)",
                messageText: "Wrong conversation",
                activeRun: AIChatStoreTestSupport.makeActiveRun()
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.conversationScopeId, explicitSessionId)
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertNil(store.activeRunId)
        XCTAssertEqual(store.composerPhase, .idle)
        guard case .failed = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap phase for a session contract mismatch.")
            return
        }
    }

    func testCanonicalReloadSessionContractMismatchDoesNotSwitchConversation() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        let expectedMessage = AIChatStoreTestSupport.makeAssistantTextMessage(
            id: "message-current",
            itemId: "item-current",
            text: "Current conversation",
            timestamp: "2026-04-08T10:00:00Z"
        )
        store.messages = [expectedMessage]
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return makeBootstrapResponse(
                sessionId: "session-2",
                conversationScopeId: "session-2",
                messageText: "Wrong canonical conversation",
                activeRun: nil
            )
        }

        store.reloadCanonicalConversationAfterAcceptedTerminalEnvelope()
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, ["session-1"])
        XCTAssertEqual(store.chatSessionId, "session-1")
        XCTAssertEqual(store.conversationScopeId, "session-1")
        XCTAssertEqual(store.messages, [expectedMessage])
        XCTAssertNil(store.activeRunId)
        XCTAssertNotNil(store.activeAlert)
    }

    func testPassiveBootstrapRefreshSessionContractMismatchDoesNotSwitchConversation() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        let expectedMessage = AIChatStoreTestSupport.makeAssistantTextMessage(
            id: "message-current",
            itemId: "item-current",
            text: "Current passive conversation",
            timestamp: "2026-04-08T10:00:00Z"
        )
        store.messages = [expectedMessage]
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return makeBootstrapResponse(
                sessionId: "session-2",
                conversationScopeId: "session-2",
                messageText: "Wrong passive conversation",
                activeRun: AIChatStoreTestSupport.makeActiveRun()
            )
        }

        store.startPassiveSnapshotRefreshIfPossible()
        let didLoadBootstrap = await AIChatStoreTestSupport.waitForCondition(
            description: "passive bootstrap refresh loaded",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.loadBootstrapSessionIds.count == 1
            }
        )
        XCTAssertTrue(didLoadBootstrap)
        try await Task.sleep(for: .milliseconds(100))

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, ["session-1"])
        XCTAssertEqual(store.chatSessionId, "session-1")
        XCTAssertEqual(store.conversationScopeId, "session-1")
        XCTAssertEqual(store.messages, [expectedMessage])
        XCTAssertNil(store.activeRunId)
        XCTAssertEqual(store.bootstrapPhase, .ready)
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

    func testBootstrapRetryExhaustsAfterThreeAttemptsAndFailsWithoutStartingRun() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.activeAlert = .generalError(title: "Stale", message: "Previous failure")
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before bootstrap retry.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap retry.")
            }

            throw URLError(.networkConnectionLost)
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [explicitSessionId])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertTrue(context.chatService.startRunRequests.isEmpty)
        XCTAssertNil(store.activeAlert)
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected bootstrapPhase.failed after bounded retry exhaustion.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
    }

    func testSendRemoteSessionProvisioningFailureAttemptsOnceAndRestoresState() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
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
                throw LocalStoreError.validation("Expected an explicit AI chat session id for foreground provisioning.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            throw URLError(.networkConnectionLost)
        }

        store.sendMessage()
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.events, ["createNewSession:\(explicitSessionId)"])
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [explicitSessionId])
        XCTAssertTrue(context.chatService.loadBootstrapSessionIds.isEmpty)
        XCTAssertTrue(context.chatService.startRunRequests.isEmpty)
        XCTAssertEqual(store.messages, [])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.conversationScopeId, explicitSessionId)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertNotNil(store.activeAlert)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: explicitSessionId
            ),
            expectedDraft
        )
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

    func testFreshLocalSessionProvisioningRetryExhaustionShowsFailedStateInsteadOfAlert() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard request.sessionId?.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during new chat provisioning.")
            }
            throw URLError(.timedOut)
        }

        store.startFreshLocalSession(
            inputText: "Draft survives",
            pendingAttachments: []
        )
        await AIChatStoreTestSupport.waitForNewSessionToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "createNewSession:\(explicitSessionId)",
            "createNewSession:\(explicitSessionId)"
        ])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, "Draft survives")
        XCTAssertNil(store.activeAlert)
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap state after new chat provisioning retry exhaustion.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
        XCTAssertNotNil(presentation.technicalDetails)
    }

    func testFreshLocalSessionRetryFailurePreservesPendingDraftAndAttachments() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let expectedAttachment = AIChatAttachment(
            id: "attachment-1",
            payload: .binary(
                fileName: "card.png",
                mediaType: "image/png",
                base64Data: "aW1hZ2U="
            )
        )
        let expectedDraft = AIChatComposerDraft(
            inputText: "Draft survives retry",
            pendingAttachments: [expectedAttachment]
        )
        context.chatService.createNewSessionHandler = { request in
            guard request.sessionId?.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during new chat retry.")
            }
            throw URLError(.timedOut)
        }

        store.startFreshLocalSession(
            inputText: expectedDraft.inputText,
            pendingAttachments: expectedDraft.pendingAttachments
        )
        await AIChatStoreTestSupport.waitForNewSessionToSettle(store: store)
        let explicitSessionId = store.chatSessionId
        XCTAssertFalse(explicitSessionId.isEmpty)

        store.activeAlert = .generalError(title: "Stale", message: "Previous failure")
        store.retryLinkedBootstrap()
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.conversationScopeId, explicitSessionId)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertEqual(store.pendingAttachments, expectedDraft.pendingAttachments)
        XCTAssertNil(store.activeAlert)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: explicitSessionId
            ),
            expectedDraft
        )
    }

    func testFreshLocalProvisionedSessionBootstrapRetryFailurePreservesPendingDraftAndAttachments() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let expectedAttachment = AIChatAttachment(
            id: "attachment-1",
            payload: .binary(
                fileName: "card.png",
                mediaType: "image/png",
                base64Data: "aW1hZ2U="
            )
        )
        let expectedDraft = AIChatComposerDraft(
            inputText: "Draft survives provisioned retry",
            pendingAttachments: [expectedAttachment]
        )
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during provisioning.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }

        store.startFreshLocalSession(
            inputText: expectedDraft.inputText,
            pendingAttachments: expectedDraft.pendingAttachments
        )
        await AIChatStoreTestSupport.waitForNewSessionToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertFalse(store.requiresRemoteSessionProvisioning)

        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, explicitSessionId)
            throw URLError(.timedOut)
        }

        store.activeAlert = .generalError(title: "Stale", message: "Previous failure")
        store.retryLinkedBootstrap()
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [explicitSessionId])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [
            explicitSessionId,
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.conversationScopeId, explicitSessionId)
        XCTAssertFalse(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertEqual(store.pendingAttachments, expectedDraft.pendingAttachments)
        XCTAssertNil(store.activeAlert)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: explicitSessionId
            ),
            expectedDraft
        )
    }

    func testBlockedCloudSyncBootstrapShowsAccountStatusMessageWithReasonDetails() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let blockedMessage = "Sync is blocked until account status is resolved."
        context.flashcardsStore.syncStatus = .blocked(message: blockedMessage)

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertTrue(context.chatService.events.isEmpty)
        XCTAssertNil(store.activeAlert)
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap state for blocked sync.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "AI chat needs your cloud account status to be resolved before it can load."
        )
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)
        XCTAssertTrue(technicalDetails.contains("Type: LocalStoreError"))
        XCTAssertTrue(technicalDetails.contains("Reason: \(blockedMessage)"))
    }

    func testFreshLocalSessionDoesNotRetryTransientCloudSessionSetupBeforeProvisioning() async throws {
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
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id after session setup retry.")
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }

        store.startFreshLocalSession(
            inputText: "Draft survives setup retry",
            pendingAttachments: []
        )
        await AIChatStoreTestSupport.waitForNewSessionToSettle(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(context.chatService.events.isEmpty)
        XCTAssertTrue(context.chatService.createNewSessionSessionIds.isEmpty)
        XCTAssertTrue(context.chatService.loadBootstrapSessionIds.isEmpty)
        XCTAssertFalse(store.chatSessionId.isEmpty)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, "Draft survives setup retry")
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap state without retrying cloud session setup.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
    }

    func testSendPreemptsPendingFreshLocalSessionProvisioningRetry() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        var createAttempts: Int = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id for foreground preemption.")
            }
            createAttempts += 1
            if createAttempts == 1 {
                throw URLError(.networkConnectionLost)
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id after foreground preemption.")
            }
            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: "Help me review this card."
            )
        }

        store.startFreshLocalSession(
            inputText: "Help me review this card.",
            pendingAttachments: []
        )

        let didReachRetrySleep = await AIChatStoreTestSupport.waitForCondition(
            description: "new chat provisioning retry sleep",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                store.activeNewSessionTask != nil
                    && context.chatService.createNewSessionSessionIds.count == 1
                    && store.requiresRemoteSessionProvisioning
            }
        )
        XCTAssertTrue(didReachRetrySleep)
        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)

        store.sendMessage()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        try await Task.sleep(for: .milliseconds(450))

        XCTAssertNil(store.activeNewSessionTask)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(context.chatService.startRunRequests.map(\.sessionId), [explicitSessionId])
        XCTAssertEqual(store.bootstrapPhase, .ready)
        XCTAssertNil(store.activeAlert)
        XCTAssertFalse(store.requiresRemoteSessionProvisioning)
    }
}

private func makeBootstrapResponse(
    sessionId: String,
    conversationScopeId: String,
    messageText: String,
    activeRun: AIChatActiveRun?
) -> AIChatBootstrapResponse {
    AIChatBootstrapResponse(
        sessionId: sessionId,
        conversationScopeId: conversationScopeId,
        conversation: AIChatConversation(
            messages: [
                AIChatStoreTestSupport.makeAssistantTextMessage(
                    id: "message-wrong",
                    itemId: "item-wrong",
                    text: messageText,
                    timestamp: "2026-04-08T10:00:00Z"
                )
            ],
            updatedAt: 1,
            mainContentInvalidationVersion: 1,
            hasOlder: false,
            oldestCursor: nil
        ),
        composerSuggestions: [],
        chatConfig: aiChatDefaultServerConfig,
        activeRun: activeRun
    )
}
