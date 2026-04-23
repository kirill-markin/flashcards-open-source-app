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

        XCTAssertTrue(store.canEditDraft)
        XCTAssertTrue(store.canAttachToDraft)
        XCTAssertTrue(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)

        store.transitionToPreparingSend()
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)

        store.transitionToStartingRun()
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)

        store.inputText = "Prepare the next draft."
        store.transitionToStreaming(activeRun: makeAIChatCapabilityTestActiveRunSession())
        XCTAssertTrue(store.canEditDraft)
        XCTAssertTrue(store.canAttachToDraft)
        XCTAssertTrue(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)
        XCTAssertFalse(store.canSendMessage)
        XCTAssertTrue(store.canStopResponse)

        store.transitionToStopping(runId: "run-1")
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertFalse(store.canUseDictation)
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
        XCTAssertFalse(store.canEditDraft)
        XCTAssertFalse(store.canAttachToDraft)
        XCTAssertFalse(store.canStartDictation)
        XCTAssertTrue(store.canUseDictation)

        store.transitionToStopping(runId: "run-1")
        XCTAssertTrue(store.canUseDictation)
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
