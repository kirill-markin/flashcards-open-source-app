import Foundation
@testable import Flashcards


extension AIChatStoreTestSupport {
    @MainActor
    final class TestVoiceRecorder: AIChatVoiceRecording {
        func startRecording() async throws {
            throw LocalStoreError.validation("Not used in AI chat dictation tests.")
        }

        func stopRecording() async throws -> AIChatRecordedAudio {
            let fileUrl = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString.lowercased())
                .appendingPathExtension("m4a")
            try Data("audio".utf8).write(to: fileUrl)
            return AIChatRecordedAudio(
                fileUrl: fileUrl,
                fileName: "chat-dictation.m4a",
                mediaType: "audio/mp4"
            )
        }

        func cancelRecording() {
        }
    }

    actor TestAudioTranscriber: AIChatAudioTranscribing {
        private var sessionIds: [String?]

        init() {
            self.sessionIds = []
        }

        func transcribe(
            session: CloudLinkedSession,
            sessionId: String?,
            recordedAudio: AIChatRecordedAudio
        ) async throws -> AIChatTranscriptionResult {
            _ = session
            _ = recordedAudio
            self.sessionIds.append(sessionId)
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id for transcription.")
            }
            return AIChatTranscriptionResult(
                text: "Transcript",
                sessionId: sessionId
            )
        }

        func transcribedSessionIds() -> [String?] {
            self.sessionIds
        }
    }
}
