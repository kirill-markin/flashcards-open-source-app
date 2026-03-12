import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class AIChatDictationTests: AIChatTestCaseBase {
    func testMergeAIChatDictationTranscriptAddsWhitespaceAroundInsertedText() {
        XCTAssertEqual(
            mergeAIChatDictationTranscript(draft: "hello", transcript: "world"),
            "hello world "
        )
        XCTAssertEqual(
            mergeAIChatDictationTranscript(draft: "hello ", transcript: "world"),
            "hello world "
        )
    }

    func testAIChatStoreDictationAppendsTranscriptToDraft() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .success("dictated text"))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.inputText = "hello"
        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.inputText, "hello dictated text ")
        XCTAssertEqual(chatStore.errorMessage, "")
    }

    func testAIChatStoreSilentlyStopsWhenMicrophonePermissionIsDeniedFromPrompt() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let recorder = StubVoiceRecorder(mode: .permissionDenied)
        let transcriber = StubAudioTranscriber(result: .success("ignored"))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertNil(chatStore.dictationAlert)
    }

    func testAIChatStoreShowsSettingsAlertWhenMicrophonePermissionIsBlocked() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let recorder = StubVoiceRecorder(mode: .permissionBlocked)
        let transcriber = StubAudioTranscriber(result: .success("ignored"))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertEqual(chatStore.dictationAlert, .microphoneSettings)
    }

    func testAIChatStoreShowsAlertForTranscriptionFailuresInsteadOfBanner() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .failure(AIChatTranscriptionError.invalidAudio))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertEqual(
            chatStore.dictationAlert,
            .transcriptionFailure(message: "We couldn’t process that recording. Please try again.")
        )
    }

    func testAIChatStoreAllowsDictationWhileStreaming() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let recorder = StubVoiceRecorder(mode: .success)
        let transcriber = StubAudioTranscriber(result: .success("dictated text"))
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor,
            voiceRecorder: recorder,
            audioTranscriber: transcriber
        )

        chatStore.inputText = "first"
        chatStore.sendMessage()
        XCTAssertTrue(chatStore.isStreaming)

        chatStore.inputText = "next"
        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .recording)

        chatStore.toggleDictation()
        try await self.waitForDictationState(chatStore: chatStore, state: .idle)

        XCTAssertTrue(chatStore.isStreaming)
        XCTAssertFalse(chatStore.canSendMessage)
        XCTAssertEqual(chatStore.inputText, "next dictated text ")

        chatStore.cancelStreaming()
    }

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
    let result: Result<String, Error>

    func transcribe(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) async throws -> String {
        _ = session
        _ = recordedAudio
        return try self.result.get()
    }
}
