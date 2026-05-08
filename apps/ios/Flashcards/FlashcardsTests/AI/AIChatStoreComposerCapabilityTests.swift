import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreComposerCapabilityTests: XCTestCase {
    func testDraftCapabilitiesAreOpenOnlyForIdleAndRunningPhases() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()

        XCTAssertTrue(store.canEditDraftText)
        XCTAssertTrue(store.canEditDraft)
        XCTAssertTrue(store.canAttachToDraft)
        XCTAssertTrue(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)
        XCTAssertFalse(store.canStartNewChat)

        store.transitionToPreparingSend()
        XCTAssertFalse(store.canEditDraftText)
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)
        XCTAssertFalse(store.canStartNewChat)

        store.transitionToStartingRun()
        XCTAssertFalse(store.canEditDraftText)
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)

        store.inputText = "Prepare the next draft."
        store.transitionToStreaming(activeRun: makeAIChatCapabilityTestActiveRunSession())
        XCTAssertTrue(store.canEditDraftText)
        XCTAssertTrue(store.canEditDraft)
        XCTAssertTrue(store.canAttachToDraft)
        XCTAssertTrue(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)
        XCTAssertFalse(store.canSendMessage)
        XCTAssertTrue(store.canStopResponse)
        XCTAssertTrue(store.canStartNewChat)

        store.transitionToStopping(runId: "run-1")
        XCTAssertFalse(store.canEditDraftText)
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)
        XCTAssertTrue(store.canStartNewChat)
    }

    func testDictationStartIsBlockedBeforeAcceptedRunButRecordingCanStillStop() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()

        store.transitionToStartingRun()
        store.startDictation()
        XCTAssertEqual(store.dictationState, .idle)
        XCTAssertNil(store.activeDictationTask)

        store.transitionToStreaming(activeRun: makeAIChatCapabilityTestActiveRunSession())
        store.dictationState = .recording
        XCTAssertTrue(store.canEditDraftText)
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)

        store.transitionToStopping(runId: "run-1")
        XCTAssertTrue(store.canEditDraftText)
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canStartNewChat)
        XCTAssertTrue(store.canUseDictation)
    }

    func testActiveDictationKeepsTextEditingOpenButLocksDraftActions() throws {
        let activeStates: [AIChatDictationState] = [
            .requestingPermission,
            .recording,
            .transcribing
        ]

        for dictationState in activeStates {
            let context = AIChatStoreTestSupport.Context.make()
            defer {
                context.tearDown()
            }

            try context.configureGuestCloudSession()
            let store = context.makeStore()
            store.acceptExternalProviderConsent()
            store.applyComposerSuggestions([
                AIChatComposerSuggestion(
                    id: "suggestion-1",
                    text: "Summarize my cards",
                    source: "test",
                    assistantItemId: nil
                )
            ])
            XCTAssertEqual(store.visibleComposerSuggestions.map(\.id), ["suggestion-1"])

            store.dictationState = dictationState

            XCTAssertTrue(store.canEditDraftText)
            XCTAssertTrue(store.visibleComposerSuggestions.isEmpty)

            let activeRun = makeAIChatCapabilityTestActiveRunSession()
            store.transitionToStreaming(activeRun: activeRun)
            store.inputText = "Draft should stay"
            XCTAssertFalse(store.canEditDraft)
            XCTAssertFalse(store.canModifyDraftAttachments)
            XCTAssertFalse(store.canAttachToDraft)
            XCTAssertFalse(store.canAttachCardToDraft)
            XCTAssertFalse(store.canStartDictation)
            XCTAssertEqual(store.canUseDictation, dictationState == .recording)
            XCTAssertFalse(store.canSendMessage)
            XCTAssertFalse(store.canStartNewChat)

            store.transitionToStopping(runId: activeRun.runId)
            XCTAssertTrue(store.canEditDraftText)
            XCTAssertFalse(store.canEditDraft)
            XCTAssertFalse(store.canModifyDraftAttachments)
            XCTAssertFalse(store.canAttachToDraft)
            XCTAssertFalse(store.canAttachCardToDraft)
            XCTAssertFalse(store.canStartDictation)
            XCTAssertEqual(store.canUseDictation, dictationState == .recording)
            XCTAssertFalse(store.canSendMessage)
            XCTAssertFalse(store.canStartNewChat)

            store.clearHistory()
            XCTAssertEqual(store.inputText, "Draft should stay")
            XCTAssertEqual(store.dictationState, dictationState)
        }
    }

    func testCardHandoffAppendsToDraftDuringRunningWithoutResettingActiveRun() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.transitionToStreaming(activeRun: makeAIChatCapabilityTestActiveRunSession())

        let didApply = store.prepareCardHandoff(
            card: AIChatCardReference(
                cardId: "card-1",
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            )
        )

        XCTAssertTrue(didApply)
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(store.activeRunId, "run-1")
        XCTAssertEqual(store.pendingAttachments.count, 1)
    }

    func testCardHandoffDoesNotDependOnFileAttachmentFeatureFlag() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.serverChatConfig = AIChatServerConfig(
            provider: aiChatDefaultServerConfig.provider,
            model: aiChatDefaultServerConfig.model,
            reasoning: aiChatDefaultServerConfig.reasoning,
            features: AIChatFeatureFlags(
                modelPickerEnabled: aiChatDefaultServerConfig.features.modelPickerEnabled,
                dictationEnabled: aiChatDefaultServerConfig.features.dictationEnabled,
                attachmentsEnabled: false
            )
        )

        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertTrue(store.canAttachCardToDraft)

        let didApply = store.prepareCardHandoff(
            card: AIChatCardReference(
                cardId: "card-1",
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            )
        )

        XCTAssertTrue(didApply)
        XCTAssertEqual(store.pendingAttachments.count, 1)
    }
}

private func makeAIChatCapabilityTestActiveRunSession() -> AIChatActiveRunSession {
    let activeRun = AIChatStoreTestSupport.makeActiveRun()
    return AIChatActiveRunSession(
        sessionId: "session-1",
        conversationScopeId: "session-1",
        runId: activeRun.runId,
        liveStream: activeRun.live.stream,
        liveCursor: activeRun.live.cursor,
        streamEpoch: nil
    )
}
