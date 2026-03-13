import AVFoundation
import Foundation

enum AIChatDictationState: Sendable, Equatable {
    case idle
    case requestingPermission
    case recording
    case transcribing
}

struct AIChatRecordedAudio: Sendable {
    let fileUrl: URL
    let fileName: String
    let mediaType: String
}

struct AIChatDictationInsertionSelection: Equatable, Sendable {
    let startUtf16Offset: Int
    let endUtf16Offset: Int
}

struct AIChatDictationInsertionResult: Equatable, Sendable {
    let text: String
    let selection: AIChatDictationInsertionSelection
}

@MainActor
protocol AIChatVoiceRecording: AnyObject {
    func startRecording() async throws
    func stopRecording() async throws -> AIChatRecordedAudio
    func cancelRecording()
}

protocol AIChatAudioTranscribing: Sendable {
    func transcribe(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) async throws -> String
}

enum AIChatVoiceRecorderError: LocalizedError, Equatable {
    case microphoneUnavailable
    case microphoneDenied
    case microphoneBlocked
    case invalidRecording
    case recordingStartFailed
    case emptyRecording

    var errorDescription: String? {
        switch self {
        case .microphoneUnavailable:
            return "Microphone is not available on this device."
        case .microphoneDenied:
            return "Microphone access was not granted."
        case .microphoneBlocked:
            return "Microphone access is turned off for Flashcards Open Source App. Enable it in Settings > Privacy & Security > Microphone."
        case .invalidRecording:
            return "Failed to prepare the recorded audio."
        case .recordingStartFailed:
            return "Failed to start microphone recording."
        case .emptyRecording:
            return "No speech was recorded."
        }
    }
}

enum AIChatTranscriptionError: LocalizedError {
    case invalidBaseUrl
    case invalidAudio
    case serviceUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return "There is a network problem. Fix it and try again."
        case .invalidAudio:
            return "We couldn’t process that recording. Please try again."
        case .serviceUnavailable:
            return "There is a network problem. Fix it and try again."
        }
    }
}

@MainActor
final class AIChatVoiceRecorder: NSObject, AIChatVoiceRecording {
    private var recorder: AVAudioRecorder?
    private var currentFileUrl: URL?

    func startRecording() async throws {
        if AVAudioApplication.shared.recordPermission == .denied {
            throw AIChatVoiceRecorderError.microphoneBlocked
        }

        if AVAudioApplication.shared.recordPermission == .undetermined {
            let status = await requestAccessPermission(kind: .microphone)
            if status != .allowed {
                throw AIChatVoiceRecorderError.microphoneDenied
            }
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try audioSession.setActive(true)

        let fileUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased())
            .appendingPathExtension("m4a")
        let settings: [String: Int] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let recorder = try AVAudioRecorder(url: fileUrl, settings: settings)
        recorder.isMeteringEnabled = false
        guard recorder.record() else {
            throw AIChatVoiceRecorderError.recordingStartFailed
        }

        self.recorder = recorder
        self.currentFileUrl = fileUrl
    }

    func stopRecording() async throws -> AIChatRecordedAudio {
        guard let recorder = self.recorder, let fileUrl = self.currentFileUrl else {
            throw AIChatVoiceRecorderError.invalidRecording
        }

        recorder.stop()
        self.recorder = nil
        self.currentFileUrl = nil
        try? AVAudioSession.sharedInstance().setActive(false)

        let attributes = try FileManager.default.attributesOfItem(atPath: fileUrl.path)
        let fileSize = attributes[.size] as? NSNumber
        if fileSize?.intValue ?? 0 <= 0 {
            try? FileManager.default.removeItem(at: fileUrl)
            throw AIChatVoiceRecorderError.emptyRecording
        }

        return AIChatRecordedAudio(
            fileUrl: fileUrl,
            fileName: "chat-dictation.m4a",
            mediaType: "audio/mp4"
        )
    }

    func cancelRecording() {
        self.recorder?.stop()
        self.recorder = nil
        if let currentFileUrl = self.currentFileUrl {
            try? FileManager.default.removeItem(at: currentFileUrl)
        }
        self.currentFileUrl = nil
        try? AVAudioSession.sharedInstance().setActive(false)
    }
}

@MainActor
final class AIChatDisabledVoiceRecorder: AIChatVoiceRecording {
    func startRecording() async throws {
        throw AIChatVoiceRecorderError.microphoneUnavailable
    }

    func stopRecording() async throws -> AIChatRecordedAudio {
        throw AIChatVoiceRecorderError.invalidRecording
    }

    func cancelRecording() {
    }
}

struct AIChatDisabledAudioTranscriber: AIChatAudioTranscribing {
    func transcribe(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) async throws -> String {
        _ = session
        _ = recordedAudio
        throw AIChatTranscriptionError.serviceUnavailable
    }
}

private struct AIChatTranscriptionResponse: Decodable {
    let text: String
}

private struct AIChatTranscriptionErrorResponse: Decodable {
    let error: String
    let code: String?
}

final class AIChatTranscriptionService: @unchecked Sendable {
    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession, decoder: JSONDecoder) {
        self.session = session
        self.decoder = decoder
    }
}

extension AIChatTranscriptionService: AIChatAudioTranscribing {
    func transcribe(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) async throws -> String {
        let request = try self.makeRequest(session: session, recordedAudio: recordedAudio)

        do {
            let (data, response) = try await self.session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw AIChatTranscriptionError.serviceUnavailable
            }

            guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
                throw self.mapTranscriptionFailure(statusCode: httpResponse.statusCode, data: data)
            }

            let transcriptionResponse = try self.decoder.decode(AIChatTranscriptionResponse.self, from: data)
            return transcriptionResponse.text
        } catch let error as AIChatTranscriptionError {
            throw error
        } catch {
            throw AIChatTranscriptionError.serviceUnavailable
        }
    }

    private func makeRequest(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) throws -> URLRequest {
        let trimmedBaseUrl = session.apiBaseUrl.hasSuffix("/") ? String(session.apiBaseUrl.dropLast()) : session.apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)/chat/transcriptions") else {
            throw AIChatTranscriptionError.invalidBaseUrl
        }

        let boundary = "Boundary-\(UUID().uuidString.lowercased())"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.makeMultipartBody(boundary: boundary, recordedAudio: recordedAudio)
        return request
    }

    private func mapTranscriptionFailure(statusCode: Int, data: Data) -> AIChatTranscriptionError {
        guard let failureResponse = try? self.decoder.decode(AIChatTranscriptionErrorResponse.self, from: data) else {
            return statusCode == 422 ? .invalidAudio : .serviceUnavailable
        }

        if failureResponse.code == "CHAT_TRANSCRIPTION_INVALID_AUDIO" || statusCode == 422 {
            return .invalidAudio
        }

        return .serviceUnavailable
    }

    private func makeMultipartBody(boundary: String, recordedAudio: AIChatRecordedAudio) throws -> Data {
        let audioData = try Data(contentsOf: recordedAudio.fileUrl)
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"source\"\r\n\r\n".utf8))
        body.append(Data("ios\r\n".utf8))
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(recordedAudio.fileName)\"\r\n".utf8))
        body.append(Data("Content-Type: \(recordedAudio.mediaType)\r\n\r\n".utf8))
        body.append(audioData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }
}

func insertAIChatDictationTranscript(
    draft: String,
    transcript: String,
    selection: AIChatDictationInsertionSelection?
) -> AIChatDictationInsertionResult {
    let trimmedTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedSelection = normalizeAIChatDictationSelection(
        selection: selection,
        maxUtf16Offset: draft.utf16.count
    )
    guard trimmedTranscript.isEmpty == false else {
        return AIChatDictationInsertionResult(text: draft, selection: normalizedSelection)
    }

    let startIndex = String.Index(utf16Offset: normalizedSelection.startUtf16Offset, in: draft)
    let endIndex = String.Index(utf16Offset: normalizedSelection.endUtf16Offset, in: draft)
    let before = String(draft[..<startIndex])
    let after = String(draft[endIndex...])
    let prefix = before.isEmpty || before.last?.isWhitespace == true ? "" : " "
    let suffix = after.isEmpty || after.first?.isWhitespace == true ? "" : " "
    let insertedText = prefix + trimmedTranscript + suffix
    let updatedText = before + insertedText + after
    let caretOffset = before.utf16.count + insertedText.utf16.count

    return AIChatDictationInsertionResult(
        text: updatedText,
        selection: AIChatDictationInsertionSelection(
            startUtf16Offset: caretOffset,
            endUtf16Offset: caretOffset
        )
    )
}

private func normalizeAIChatDictationSelection(
    selection: AIChatDictationInsertionSelection?,
    maxUtf16Offset: Int
) -> AIChatDictationInsertionSelection {
    guard let selection else {
        return AIChatDictationInsertionSelection(
            startUtf16Offset: maxUtf16Offset,
            endUtf16Offset: maxUtf16Offset
        )
    }

    let clampedStart = min(max(selection.startUtf16Offset, 0), maxUtf16Offset)
    let clampedEnd = min(max(selection.endUtf16Offset, 0), maxUtf16Offset)
    return clampedStart <= clampedEnd
        ? AIChatDictationInsertionSelection(startUtf16Offset: clampedStart, endUtf16Offset: clampedEnd)
        : AIChatDictationInsertionSelection(startUtf16Offset: clampedEnd, endUtf16Offset: clampedStart)
}
