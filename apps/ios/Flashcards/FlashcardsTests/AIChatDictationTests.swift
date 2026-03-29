import Foundation
import SwiftUI
import XCTest
@testable import Flashcards

final class AIChatDictationTests: AIChatTestCaseBase {
    @MainActor
    func testInsertAIChatDictationTranscriptInsertsAtCaretWithWhitespaceAroundInsertedText() {
        XCTAssertEqual(
            insertAIChatDictationTranscript(
                draft: "helloworld",
                transcript: "dictated",
                selection: AIChatDictationInsertionSelection(startUtf16Offset: 5, endUtf16Offset: 5)
            ),
            AIChatDictationInsertionResult(
                text: "hello dictated world",
                selection: AIChatDictationInsertionSelection(
                    startUtf16Offset: "hello dictated ".utf16.count,
                    endUtf16Offset: "hello dictated ".utf16.count
                )
            )
        )
    }

    @MainActor
    func testInsertAIChatDictationTranscriptReplacesSelectedRange() {
        XCTAssertEqual(
            insertAIChatDictationTranscript(
                draft: "hello brave world",
                transcript: "dictated",
                selection: AIChatDictationInsertionSelection(startUtf16Offset: 6, endUtf16Offset: 11)
            ),
            AIChatDictationInsertionResult(
                text: "hello dictated world",
                selection: AIChatDictationInsertionSelection(
                    startUtf16Offset: "hello dictated".utf16.count,
                    endUtf16Offset: "hello dictated".utf16.count
                )
            )
        )
    }

    @MainActor
    func testInsertAIChatDictationTranscriptAppendsAtEndWhenSelectionIsMissing() {
        XCTAssertEqual(
            insertAIChatDictationTranscript(draft: "hello", transcript: "world", selection: nil),
            AIChatDictationInsertionResult(
                text: "hello world",
                selection: AIChatDictationInsertionSelection(
                    startUtf16Offset: "hello world".utf16.count,
                    endUtf16Offset: "hello world".utf16.count
                )
            )
        )
    }

    @MainActor
    func testInsertAIChatDictationTranscriptReturnsOriginalDraftForBlankTranscript() {
        XCTAssertEqual(
            insertAIChatDictationTranscript(draft: "hello", transcript: "   ", selection: nil),
            AIChatDictationInsertionResult(
                text: "hello",
                selection: AIChatDictationInsertionSelection(
                    startUtf16Offset: "hello".utf16.count,
                    endUtf16Offset: "hello".utf16.count
                )
            )
        )
    }

    @MainActor
    func testAIChatDictationInsertionSelectionReturnsNilForStaleSelectionRange() {
        let previousText = "hello"
        let startIndex = previousText.index(previousText.startIndex, offsetBy: 1)
        let endIndex = previousText.index(previousText.startIndex, offsetBy: 4)

        XCTAssertNil(
            aiChatDictationInsertionSelection(
                text: "",
                selection: TextSelection(range: startIndex..<endIndex)
            )
        )
    }

    @MainActor
    func testAIChatStoreDictationPublishesCompletedTranscriptWithoutMutatingDraft() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .success(
            AIChatTranscriptionResult(text: "dictated text", sessionId: "session-1")
        ))
        let historyStore = InMemoryHistoryStore(
            savedState: AIChatPersistedState(messages: [])
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.inputText = "hello"
        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.inputText, "hello")
        XCTAssertEqual(chatStore.completedDictationTranscript?.transcript, "dictated text")
        XCTAssertNil(chatStore.activeAlert)
        XCTAssertEqual(historyStore.savedState.chatSessionId, "session-1")
    }

    @MainActor
    func testAIChatStoreSilentlyStopsWhenMicrophonePermissionIsDeniedFromPrompt() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .permissionDenied)
        let transcriber = StubAudioTranscriber(result: .success(
            AIChatTranscriptionResult(text: "ignored", sessionId: "session-1")
        ))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [])
            ),
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertNil(chatStore.activeAlert)
    }

    @MainActor
    func testAIChatStoreShowsSettingsAlertWhenMicrophonePermissionIsBlocked() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .permissionBlocked)
        let transcriber = StubAudioTranscriber(result: .success(
            AIChatTranscriptionResult(text: "ignored", sessionId: "session-1")
        ))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [])
            ),
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.activeAlert, .microphoneSettings)
    }

    @MainActor
    func testAIChatStoreShowsGeneralAlertForTranscriptionFailures() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .failure(AIChatTranscriptionError.invalidAudio))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [])
            ),
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: "We couldn’t process that recording. Please try again.")
        )
    }

    @MainActor
    func testAIChatStoreShowsAccountUpgradePromptForGuestLimitDictationFailures() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let historyStore = InMemoryHistoryStore(
            savedState: AIChatPersistedState(messages: [])
        )
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .failure(AIChatTranscriptionError.guestLimitReached))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertNil(chatStore.activeAlert)
        XCTAssertNil(chatStore.completedDictationTranscript)
        XCTAssertEqual(chatStore.messages.count, 1)
        XCTAssertEqual(chatStore.messages[0].role, .assistant)
        XCTAssertEqual(chatStore.messages[0].accountUpgradePrompt?.message, aiChatGuestQuotaReachedMessage)
        XCTAssertEqual(chatStore.messages[0].accountUpgradePrompt?.buttonTitle, aiChatGuestQuotaButtonTitle)
        XCTAssertEqual(chatStore.messages[0].isError, false)
        XCTAssertEqual(historyStore.savedState.messages.first?.accountUpgradePrompt?.message, aiChatGuestQuotaReachedMessage)
    }

    @MainActor
    func testAIChatStoreAllowsDictationWhileStreaming() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .success(
            AIChatTranscriptionResult(text: "dictated text", sessionId: "session-1")
        ))
        let chatService = SuspendingChatService()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [])
            ),
            chatService: chatService,
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.inputText = "first"
        chatStore.sendMessage()
        try await self.waitForAsyncCondition(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000,
            failureMessage: "Timed out waiting for backend chat run start"
        ) {
            await chatService.hasStartedRun()
        }
        XCTAssertTrue(chatStore.isStreaming)

        chatStore.inputText = "next"
        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertTrue(chatStore.isStreaming)
        XCTAssertFalse(chatStore.canSendMessage)
        XCTAssertEqual(chatStore.inputText, "next")
        XCTAssertEqual(chatStore.completedDictationTranscript?.transcript, "dictated text")

        chatStore.cancelStreaming()
        try await self.waitForAsyncCondition(
            timeoutNanoseconds: 3_000_000_000,
            pollNanoseconds: 20_000_000,
            failureMessage: "Timed out waiting for canceled chat cleanup"
        ) {
            await chatService.hasStoppedRun()
        }
    }

    @MainActor
    func testAIChatStoreBlocksDictationWhenExternalAIConsentIsMissing() throws {
        let flashcardsStore = try self.makeLinkedStoreWithoutAIConsent()
        let contextLoader = StubContextLoader()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .success(
            AIChatTranscriptionResult(text: "dictated text", sessionId: "session-1")
        ))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [])
            ),
            chatService: FailingChatService(),
            contextLoader: contextLoader,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()

        XCTAssertEqual(chatStore.dictationState, .idle)
        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: aiChatExternalProviderConsentRequiredMessage)
        )
    }

    @MainActor
    func testAIChatAvailabilityMessageUsesOfficialAndCustomServerCopy() {
        XCTAssertEqual(
            aiChatAvailabilityMessage(
                code: "LOCAL_CHAT_NOT_CONFIGURED",
                configurationMode: .official,
                surface: .chat
            ),
            "AI is temporarily unavailable on the official server. Try again later."
        )
        XCTAssertEqual(
            aiChatAvailabilityMessage(
                code: "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
                configurationMode: .custom,
                surface: .dictation
            ),
            "AI dictation is unavailable on this server. Contact the server operator."
        )
    }

    @MainActor
    func testAIChatTranscriptionServiceOmitsDurationSecondsFromMultipartRequest() async throws {
        let recordedAudioFileUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased())
            .appendingPathExtension("m4a")
        try Data("audio".utf8).write(to: recordedAudioFileUrl)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: recordedAudioFileUrl)
        }

        let service = AIChatTranscriptionService(
            session: self.makeSession(),
            decoder: JSONDecoder()
        )
        let recordedAudio = AIChatRecordedAudio(
            fileUrl: recordedAudioFileUrl,
            fileName: "chat-dictation.m4a",
            mediaType: "audio/mp4"
        )
        AIChatMockUrlProtocol.requestHandler = { request in
            let bodyData = try XCTUnwrap(request.httpBody)
            let bodyString = String(decoding: bodyData, as: UTF8.self)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/v1/chat/transcriptions")
            XCTAssertTrue(bodyString.contains("name=\"source\""))
            XCTAssertTrue(bodyString.contains("ios\r\n"))
            XCTAssertTrue(bodyString.contains("name=\"file\"; filename=\"chat-dictation.m4a\""))
            XCTAssertFalse(bodyString.contains("name=\"durationSeconds\""))
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ))
            return (response, Data(#"{"text":"dictated text","sessionId":"session-1"}"#.utf8))
        }

        let transcript = try await service.transcribe(
            session: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: "workspace-1"),
            sessionId: nil,
            recordedAudio: recordedAudio
        )

        XCTAssertEqual(transcript.text, "dictated text")
        XCTAssertEqual(transcript.sessionId, "session-1")
    }

    @MainActor
    func testMakeAIChatUserFacingErrorMessagePreservesRequestReferences() {
        XCTAssertEqual(
            makeAIChatUserFacingErrorMessage(
                rawMessage: "AI chat is not configured on this server.",
                code: "LOCAL_CHAT_NOT_CONFIGURED",
                requestId: "request-123",
                configurationMode: .custom,
                surface: .chat
            ),
            "AI is unavailable on this server. Contact the server operator. Reference: request-123"
        )
    }

    @MainActor
    private func waitForDictationState(
        chatStore: AIChatStore,
        state: AIChatDictationState
    ) async throws {
        for _ in 0..<80 {
            if chatStore.dictationState == state {
                return
            }

            try await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTFail("Timed out waiting for dictation state \(state)")
    }
}

private enum StubVoiceRecorderMode {
    case success
    case permissionDenied
    case permissionBlocked
}

@MainActor
private final class StubVoiceRecorder: AIChatVoiceRecording {
    private let mode: StubVoiceRecorderMode
    private var tempFileUrl: URL?

    init(mode: StubVoiceRecorderMode) {
        self.mode = mode
    }

    func startRecording() async throws {
        switch self.mode {
        case .success:
            return
        case .permissionDenied:
            throw AIChatVoiceRecorderError.microphoneDenied
        case .permissionBlocked:
            throw AIChatVoiceRecorderError.microphoneBlocked
        }
    }

    func stopRecording() async throws -> AIChatRecordedAudio {
        let fileUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased())
            .appendingPathExtension("m4a")
        try Data("audio".utf8).write(to: fileUrl)
        self.tempFileUrl = fileUrl
        return AIChatRecordedAudio(
            fileUrl: fileUrl,
            fileName: "chat-dictation.m4a",
            mediaType: "audio/mp4"
        )
    }

    func cancelRecording() {
        if let tempFileUrl = self.tempFileUrl {
            try? FileManager.default.removeItem(at: tempFileUrl)
        }
        self.tempFileUrl = nil
    }
}

private struct StubAudioTranscriber: AIChatAudioTranscribing {
    let result: Result<AIChatTranscriptionResult, Error>

    func transcribe(
        session: CloudLinkedSession,
        sessionId: String?,
        recordedAudio: AIChatRecordedAudio
    ) async throws -> AIChatTranscriptionResult {
        _ = session
        _ = sessionId
        _ = recordedAudio
        return try self.result.get()
    }
}
