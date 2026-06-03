import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningDictationTests: XCTestCase {
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

}
