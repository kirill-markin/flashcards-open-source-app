import Foundation
import XCTest
@testable import Flashcards

private final class BlockingAIChatHistoryStore: AIChatHistoryStoring, @unchecked Sendable {
    private let base: AIChatHistoryStore
    private let lock: NSLock
    private let blockedSaveReleaseSemaphore: DispatchSemaphore
    private var remainingBlockedStateSaves: Int
    private var hasBlockedStateSaveStartedFlag: Bool

    init(base: AIChatHistoryStore) {
        self.base = base
        self.lock = NSLock()
        self.blockedSaveReleaseSemaphore = DispatchSemaphore(value: 0)
        self.remainingBlockedStateSaves = 0
        self.hasBlockedStateSaveStartedFlag = false
    }

    func blockNextStateSave() {
        self.lock.lock()
        self.remainingBlockedStateSaves += 1
        self.hasBlockedStateSaveStartedFlag = false
        self.lock.unlock()
    }

    func hasBlockedStateSaveStarted() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        return self.hasBlockedStateSaveStartedFlag
    }

    func releaseBlockedStateSave() {
        self.blockedSaveReleaseSemaphore.signal()
    }

    private func shouldBlockStateSave() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        guard self.remainingBlockedStateSaves > 0 else {
            return false
        }

        self.remainingBlockedStateSaves -= 1
        return true
    }

    func activateWorkspace(workspaceId: String?) {
        self.base.activateWorkspace(workspaceId: workspaceId)
    }

    func loadState() -> AIChatPersistedState {
        self.base.loadState()
    }

    func loadState(workspaceId: String?) -> AIChatPersistedState {
        self.base.loadState(workspaceId: workspaceId)
    }

    func saveStateSynchronously(workspaceId: String?, state: AIChatPersistedState) {
        if self.shouldBlockStateSave() {
            self.lock.lock()
            self.hasBlockedStateSaveStartedFlag = true
            self.lock.unlock()
            _ = self.blockedSaveReleaseSemaphore.wait(timeout: .now() + 3)
        }

        self.base.saveStateSynchronously(workspaceId: workspaceId, state: state)
    }

    func saveState(state: AIChatPersistedState) async {
        await self.base.saveState(state: state)
    }

    func saveState(workspaceId: String?, state: AIChatPersistedState) async {
        await self.base.saveState(workspaceId: workspaceId, state: state)
    }

    func clearState() async {
        await self.base.clearState()
    }

    func loadDraft(workspaceId: String?, sessionId: String?) -> AIChatComposerDraft {
        self.base.loadDraft(workspaceId: workspaceId, sessionId: sessionId)
    }

    func loadDraftRestoreSuppression(workspaceId: String?, sessionId: String?) -> Bool {
        self.base.loadDraftRestoreSuppression(workspaceId: workspaceId, sessionId: sessionId)
    }

    func saveDraftSynchronously(workspaceId: String?, sessionId: String?, draft: AIChatComposerDraft) {
        self.base.saveDraftSynchronously(workspaceId: workspaceId, sessionId: sessionId, draft: draft)
    }

    func saveDraftRestoreSuppressionSynchronously(
        workspaceId: String?,
        sessionId: String?,
        isSuppressed: Bool
    ) {
        self.base.saveDraftRestoreSuppressionSynchronously(
            workspaceId: workspaceId,
            sessionId: sessionId,
            isSuppressed: isSuppressed
        )
    }

    func saveDraft(workspaceId: String?, sessionId: String?, draft: AIChatComposerDraft) async {
        await self.base.saveDraft(workspaceId: workspaceId, sessionId: sessionId, draft: draft)
    }
}

private actor AIChatRuntimeEventRecorder {
    private var labels: [String]

    init() {
        self.labels = []
    }

    func record(_ event: AIChatRuntimeEvent) {
        switch event {
        case .accepted:
            self.labels.append("accepted")
        case .liveEvent:
            self.labels.append("liveEvent")
        case .appendAssistantAccountUpgradePrompt:
            self.labels.append("appendAssistantAccountUpgradePrompt")
        case .finish:
            self.labels.append("finish")
        case .fail:
            self.labels.append("fail")
        }
    }

    func snapshot() -> [String] {
        self.labels
    }
}

@MainActor
final class AIChatStoreRunStartTests: XCTestCase {
    func testSendMessageSuppressionSnapshotWinsOverOlderQueuedStateSave() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let historyStore = BlockingAIChatHistoryStore(base: context.historyStore)
        let store = AIChatStore(
            flashcardsStore: context.flashcardsStore,
            historyStore: historyStore,
            chatService: context.chatService,
            contextLoader: AIChatStoreTestSupport.ContextLoader(),
            voiceRecorder: AIChatDisabledVoiceRecorder(),
            audioTranscriber: AIChatDisabledAudioTranscriber()
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.messages = [
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-1",
                itemId: "item-1",
                text: "Earlier response.",
                timestamp: "2026-04-08T10:00:00Z"
            )
        ]

        historyStore.blockNextStateSave()
        store.schedulePersistCurrentState()
        let didBlockOlderStateSave = await AIChatStoreTestSupport.waitForCondition(
            description: "older queued state save blocked before send",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                historyStore.hasBlockedStateSaveStarted()
            }
        )
        XCTAssertTrue(didBlockOlderStateSave)

        let releaseOlderSaveTask = Task.detached {
            try? await Task.sleep(for: .milliseconds(20))
            historyStore.releaseBlockedStateSave()
        }
        store.suppressDraftRestore = true
        store.persistStateSynchronously(state: store.currentPersistedState())
        await releaseOlderSaveTask.value

        let persistedState = context.historyStore.loadState(workspaceId: store.historyWorkspaceId())
        XCTAssertTrue(persistedState.suppressDraftRestore)
        XCTAssertEqual(persistedState.messages.count, 1)
        XCTAssertEqual(persistedState.chatSessionId, "session-1")
    }

    func testSendMessageKeepsDraftDurableBeforeRunAcceptanceAcrossRestart() async throws {
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
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        let draftAttachment = AIChatAttachment(
            id: "attachment-card-1",
            payload: .card(
                AIChatCardReference(
                    cardId: "card-1",
                    frontText: "Front",
                    backText: "Back",
                    tags: ["tag-1"],
                    effortLevel: .medium
                )
            )
        )
        let persistedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: [draftAttachment]
        )
        store.inputText = persistedDraft.inputText
        store.pendingAttachments = persistedDraft.pendingAttachments
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId else {
                throw LocalStoreError.validation("Expected a chat session id while starting the run.")
            }

            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: persistedDraft.inputText
            )
        }

        let didPersistInitialDraft = await AIChatStoreTestSupport.waitForCondition(
            description: "initial draft persisted before send",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                store.activeDraftPersistTask == nil
                    && context.historyStore.loadDraft(
                        workspaceId: store.historyWorkspaceId(),
                        sessionId: "session-1"
                    ) == persistedDraft
            }
        )
        XCTAssertTrue(didPersistInitialDraft)

        store.sendMessage()

        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            persistedDraft
        )
        XCTAssertFalse(
            context.historyStore.loadDraftRestoreSuppression(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            )
        )
        XCTAssertFalse(
            context.historyStore.loadState(
                workspaceId: store.historyWorkspaceId()
            ).suppressDraftRestore
        )

        context.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        let restartedStore = context.makeStore()
        XCTAssertEqual(restartedStore.inputText, persistedDraft.inputText)
        XCTAssertEqual(restartedStore.pendingAttachments, persistedDraft.pendingAttachments)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: restartedStore.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            persistedDraft
        )
        XCTAssertFalse(
            context.historyStore.loadDraftRestoreSuppression(
                workspaceId: restartedStore.historyWorkspaceId(),
                sessionId: "session-1"
            )
        )
        XCTAssertFalse(
            context.historyStore.loadState(
                workspaceId: restartedStore.historyWorkspaceId()
            ).suppressDraftRestore
        )

        let replacementDraft = AIChatComposerDraft(
            inputText: "A new draft after restart.",
            pendingAttachments: []
        )
        restartedStore.inputText = replacementDraft.inputText
        restartedStore.pendingAttachments = replacementDraft.pendingAttachments
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: restartedStore.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            replacementDraft
        )

        let secondRestartedStore = context.makeStore()
        XCTAssertEqual(secondRestartedStore.inputText, replacementDraft.inputText)
        XCTAssertEqual(secondRestartedStore.pendingAttachments, replacementDraft.pendingAttachments)

        await syncGate.release()
    }

    func testAcceptedRunClearsDraftDurablyAcrossRestart() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        let acceptedUserTimestamp = nowIsoTimestamp()
        let acceptedAssistantTimestamp = nowIsoTimestamp()

        let acceptedMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-user-1",
                text: "Help me review this card.",
                timestamp: acceptedUserTimestamp
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-assistant-1",
                itemId: "item-1",
                text: "Working on it.",
                timestamp: acceptedAssistantTimestamp
            )
        ]
        let persistedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: []
        )
        store.inputText = persistedDraft.inputText

        let didPersistInitialDraft = await AIChatStoreTestSupport.waitForCondition(
            description: "accepted-run draft persisted before runtime acceptance",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.historyStore.loadDraft(
                    workspaceId: store.historyWorkspaceId(),
                    sessionId: "session-1"
                ) == persistedDraft
            }
        )
        XCTAssertTrue(didPersistInitialDraft)

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: acceptedMessages,
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: false,
                        oldestCursor: nil
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: nil,
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertFalse(
            context.historyStore.loadDraftRestoreSuppression(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            )
        )

        context.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        let restartedStore = context.makeStore()

        XCTAssertEqual(restartedStore.inputText, "")
        XCTAssertTrue(restartedStore.pendingAttachments.isEmpty)
        XCTAssertEqual(restartedStore.messages, acceptedMessages)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: restartedStore.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertFalse(
            context.historyStore.loadState(
                workspaceId: restartedStore.historyWorkspaceId()
            ).suppressDraftRestore
        )
    }

    func testAcceptedRunClearsSuppressionStateSynchronouslyDespiteOlderQueuedSave() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let historyStore = BlockingAIChatHistoryStore(base: context.historyStore)
        let store = AIChatStore(
            flashcardsStore: context.flashcardsStore,
            historyStore: historyStore,
            chatService: context.chatService,
            contextLoader: AIChatStoreTestSupport.ContextLoader(),
            voiceRecorder: AIChatDisabledVoiceRecorder(),
            audioTranscriber: AIChatDisabledAudioTranscriber()
        )
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        store.suppressDraftRestore = true
        store.inputText = "Pending draft"
        store.persistDraftRestoreSuppressionSynchronously(
            workspaceId: store.historyWorkspaceId(),
            sessionId: "session-1",
            isSuppressed: true
        )

        historyStore.blockNextStateSave()
        store.schedulePersistCurrentState()
        let didBlockOlderStateSave = await AIChatStoreTestSupport.waitForCondition(
            description: "older queued state save blocked before accepted handling",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                historyStore.hasBlockedStateSaveStarted()
            }
        )
        XCTAssertTrue(didBlockOlderStateSave)

        let releaseOlderSaveTask = Task.detached {
            try? await Task.sleep(for: .milliseconds(20))
            historyStore.releaseBlockedStateSave()
        }
        await store.handleRuntimeEvent(
            .accepted(
                AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                    sessionId: "session-1",
                    userText: "Pending draft"
                )
            ),
            conversationId: "conversation-1"
        )
        await releaseOlderSaveTask.value

        let persistedState = context.historyStore.loadState(workspaceId: store.historyWorkspaceId())
        XCTAssertFalse(store.suppressDraftRestore)
        XCTAssertFalse(persistedState.suppressDraftRestore)
        XCTAssertEqual(persistedState.chatSessionId, "session-1")
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            ),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertFalse(
            context.historyStore.loadDraftRestoreSuppression(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-1"
            )
        )
    }

    func testSendMessageAppendsOptimisticTurnBeforeAsyncPreparationCompletes() async throws {
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
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.inputText = "Help me review this card."
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId else {
                throw LocalStoreError.validation("Expected a chat session id while starting the run.")
            }

            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: "Help me review this card."
            )
        }

        store.sendMessage()
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[0].role, .user)
        XCTAssertEqual(store.messages[0].content, [.text("Help me review this card.")])
        XCTAssertEqual(store.messages[1].role, .assistant)
        XCTAssertTrue(isOptimisticAIChatStatusContent(content: store.messages[1].content))
        XCTAssertEqual(store.activeStreamingMessageId, store.messages[1].id)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.composerPhase, .preparingSend)
        XCTAssertNotNil(store.activeSendTask)

        await syncGate.release()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
    }

    func testSendStartRunFailureRestoresPendingRemoteSessionProvisioningState() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = "session-explicit"
        store.conversationScopeId = "session-explicit"
        store.requiresRemoteSessionProvisioning = true
        let expectedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: []
        )
        store.inputText = expectedDraft.inputText
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id while provisioning.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id while starting the run.")
            }

            throw LocalStoreError.validation("AI chat start-run failed.")
        }

        store.sendMessage()
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertEqual(store.chatSessionId, "session-explicit")
        XCTAssertEqual(store.conversationScopeId, "session-explicit")
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertNotNil(store.activeAlert)

        let persistedState = context.historyStore.loadState()
        XCTAssertTrue(persistedState.messages.isEmpty)
        XCTAssertEqual(persistedState.chatSessionId, "session-explicit")
        XCTAssertFalse(persistedState.suppressDraftRestore)
        XCTAssertEqual(
            context.historyStore.loadDraft(
                workspaceId: store.historyWorkspaceId(),
                sessionId: "session-explicit"
            ),
            expectedDraft
        )
    }

    func testHandleSendMessageErrorRestoresDraftAndAttachmentsForGuestQuotaBeforeRunAcceptance() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let draftAttachment = AIChatAttachment(
            id: "attachment-card-1",
            payload: .card(
                AIChatCardReference(
                    cardId: "card-1",
                    frontText: "Front",
                    backText: "Back",
                    tags: ["tag-1"],
                    effortLevel: .medium
                )
            )
        )
        let expectedDraft = AIChatComposerDraft(
            inputText: "Help me review this card.",
            pendingAttachments: [draftAttachment]
        )
        store.chatSessionId = "session-guest"
        store.conversationScopeId = "session-guest"
        store.inputText = expectedDraft.inputText
        store.pendingAttachments = expectedDraft.pendingAttachments

        let didPersistDraft = await AIChatStoreTestSupport.waitForCondition(
            description: "guest quota draft persisted",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                store.activeDraftPersistTask == nil
                    && context.historyStore.loadDraft(
                        workspaceId: store.historyWorkspaceId(),
                        sessionId: "session-guest"
                    ) == expectedDraft
            }
        )
        XCTAssertTrue(didPersistDraft)

        let outgoingContent = store.makeOutgoingContent()
        let preSendSnapshot = AIChatPreSendSnapshot(
            persistedState: store.currentPersistedState(),
            requiresRemoteSessionProvisioning: false,
            outgoingContent: outgoingContent
        )

        store.transitionToPreparingSend()
        store.applyComposerDraft(inputText: "", pendingAttachments: [])
        store.appendOptimisticOutgoingTurn(content: outgoingContent)

        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[0].role, .user)
        XCTAssertEqual(store.messages[0].content, outgoingContent)
        XCTAssertEqual(store.messages[1].role, .assistant)
        XCTAssertTrue(isOptimisticAIChatStatusContent(content: store.messages[1].content))

        store.handleSendMessageError(
            makeGuestQuotaError(),
            didAcceptRun: false,
            didAppendOptimisticMessages: true,
            preSendSnapshot: preSendSnapshot,
            draftText: expectedDraft.inputText,
            draftAttachments: expectedDraft.pendingAttachments
        )

        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertEqual(store.pendingAttachments, expectedDraft.pendingAttachments)
        XCTAssertEqual(store.messages.count, 1)
        XCTAssertEqual(store.messages[0].role, .assistant)
        XCTAssertEqual(
            store.messages[0].content,
            [.accountUpgradePrompt(
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            )]
        )
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertNil(store.activeAlert)

        let historyWorkspaceId = makeAIChatHistoryScopedWorkspaceId(
            workspaceId: context.flashcardsStore.workspace?.workspaceId,
            cloudSettings: context.flashcardsStore.cloudSettings
        )
        XCTAssertEqual(
            context.historyStore.loadDraft(workspaceId: historyWorkspaceId, sessionId: "session-guest"),
            expectedDraft
        )
        XCTAssertEqual(
            context.historyStore.loadState(workspaceId: historyWorkspaceId).messages,
            store.messages
        )
    }

    func testHandleSendMessageErrorAppendsGuestQuotaPromptAfterRestoredAssistantReply() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let restoredUserMessage = AIChatMessage(
            id: "message-history-user-1",
            role: .user,
            content: [.text("Explain leitner spacing.")],
            timestamp: "2026-04-08T10:00:00Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-history-user-1",
            itemId: nil
        )
        let restoredAssistantMessage = AIChatMessage(
            id: "message-history-assistant-1",
            role: .assistant,
            content: [.text("Leitner spacing increases review intervals after correct answers.")],
            timestamp: "2026-04-08T10:00:02Z",
            isError: false,
            isStopped: true,
            cursor: "cursor-history-assistant-1",
            itemId: "item-history-assistant-1"
        )
        let draftAttachment = AIChatAttachment(
            id: "attachment-card-1",
            payload: .card(
                AIChatCardReference(
                    cardId: "card-1",
                    frontText: "Front",
                    backText: "Back",
                    tags: ["tag-1"],
                    effortLevel: .medium
                )
            )
        )
        let expectedDraft = AIChatComposerDraft(
            inputText: "Give me one more example.",
            pendingAttachments: [draftAttachment]
        )

        store.messages = [restoredUserMessage, restoredAssistantMessage]
        store.chatSessionId = "session-guest"
        store.conversationScopeId = "session-guest"
        store.inputText = expectedDraft.inputText
        store.pendingAttachments = expectedDraft.pendingAttachments

        let didPersistDraft = await AIChatStoreTestSupport.waitForCondition(
            description: "guest quota draft persisted with restored assistant history",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                store.activeDraftPersistTask == nil
                    && context.historyStore.loadDraft(
                        workspaceId: store.historyWorkspaceId(),
                        sessionId: "session-guest"
                    ) == expectedDraft
            }
        )
        XCTAssertTrue(didPersistDraft)

        let outgoingContent = store.makeOutgoingContent()
        let preSendSnapshot = AIChatPreSendSnapshot(
            persistedState: store.currentPersistedState(),
            requiresRemoteSessionProvisioning: false,
            outgoingContent: outgoingContent
        )

        store.transitionToPreparingSend()
        store.applyComposerDraft(inputText: "", pendingAttachments: [])
        store.appendOptimisticOutgoingTurn(content: outgoingContent)

        store.handleSendMessageError(
            makeGuestQuotaError(),
            didAcceptRun: false,
            didAppendOptimisticMessages: true,
            preSendSnapshot: preSendSnapshot,
            draftText: expectedDraft.inputText,
            draftAttachments: expectedDraft.pendingAttachments
        )

        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.inputText, expectedDraft.inputText)
        XCTAssertEqual(store.pendingAttachments, expectedDraft.pendingAttachments)
        XCTAssertEqual(store.messages.count, 3)
        XCTAssertEqual(store.messages[0], restoredUserMessage)
        XCTAssertEqual(store.messages[1], restoredAssistantMessage)
        XCTAssertEqual(store.messages[1].content, restoredAssistantMessage.content)
        XCTAssertEqual(store.messages[2].role, .assistant)
        XCTAssertEqual(
            store.messages[2].content,
            [.accountUpgradePrompt(
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            )]
        )
        XCTAssertNotEqual(store.messages[2].id, restoredAssistantMessage.id)
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertNil(store.activeAlert)

        let historyWorkspaceId = makeAIChatHistoryScopedWorkspaceId(
            workspaceId: context.flashcardsStore.workspace?.workspaceId,
            cloudSettings: context.flashcardsStore.cloudSettings
        )
        XCTAssertEqual(
            context.historyStore.loadDraft(workspaceId: historyWorkspaceId, sessionId: "session-guest"),
            expectedDraft
        )
        XCTAssertEqual(
            context.historyStore.loadState(workspaceId: historyWorkspaceId).messages,
            store.messages
        )
    }

    func testRuntimeRunRethrowsGuestQuotaFailureWithoutRecoveryEvents() async throws {
        let chatService = AIChatStoreTestSupport.ChatService()
        chatService.startRunHandler = { _ in
            throw makeGuestQuotaError()
        }
        let runtime = AIChatSessionRuntime(
            chatService: chatService,
            contextLoader: AIChatStoreTestSupport.ContextLoader(),
            urlSession: URLSession.shared
        )
        let recorder = AIChatRuntimeEventRecorder()
        let session = CloudLinkedSession(
            userId: "guest-user-1",
            workspaceId: "workspace-1",
            email: nil,
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com",
            authorization: .guest("guest-token-1")
        )

        do {
            try await runtime.run(
                session: session,
                sessionId: "session-guest",
                afterCursor: nil,
                outgoingContent: [.text("Help me review this card.")],
                eventHandler: { event in
                    await recorder.record(event)
                }
            )
            XCTFail("Expected the runtime to rethrow the guest AI quota failure.")
        } catch {
            XCTAssertTrue(isGuestAiLimitError(error: error))
            guard let serviceError = error as? AIChatServiceError else {
                return XCTFail("Expected an invalid-response guest quota error.")
            }
            guard case .invalidResponse(let errorDetails, _, _) = serviceError else {
                return XCTFail("Expected an invalid-response guest quota error.")
            }
            XCTAssertEqual(errorDetails.code, "GUEST_AI_LIMIT_REACHED")
        }

        let recordedEvents = await recorder.snapshot()
        XCTAssertEqual(recordedEvents, [])
    }
}

private func makeGuestQuotaError() -> AIChatServiceError {
    AIChatServiceError.invalidResponse(
        CloudApiErrorDetails(
            message: "Guest AI limit reached.",
            requestId: "request-guest-limit",
            code: "GUEST_AI_LIMIT_REACHED"
        ),
        "Guest AI limit reached.",
        AIChatFailureDiagnostics(
            clientRequestId: "client-request-1",
            backendRequestId: "request-guest-limit",
            stage: .responseNotOk,
            errorKind: .backendErrorEvent,
            statusCode: 429,
            eventType: nil,
            toolName: nil,
            toolCallId: nil,
            lineNumber: nil,
            rawSnippet: nil,
            decoderSummary: nil,
            continuationAttempt: nil,
            continuationToolCallIds: []
        )
    )
}
