import AVFoundation
import Foundation

enum AIChatDictationState: Sendable, Equatable {
    case idle
    case requestingPermission
    case recording
    case transcribing
}

struct AIChatRecordedAudio {
    let fileUrl: URL
    let fileName: String
    let mediaType: String
}

protocol AIChatVoiceRecording: AnyObject {
    func startRecording() async throws
    func stopRecording() async throws -> AIChatRecordedAudio
    func cancelRecording()
}

protocol AIChatAudioTranscribing {
    func transcribe(session: CloudLinkedSession, recordedAudio: AIChatRecordedAudio) async throws -> String
}

enum AIChatVoiceRecorderError: LocalizedError, Equatable {
    case microphoneUnavailable
    case microphoneDenied
    case invalidRecording
    case recordingStartFailed
    case emptyRecording

    var errorDescription: String? {
        switch self {
        case .microphoneUnavailable:
            return "Microphone is not available on this device."
        case .microphoneDenied:
            return "Microphone access is turned off for Flashcards. Enable it in Settings > Privacy & Security > Microphone."
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
    case invalidResponse
    case networkFailure

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return "There is a network problem. Fix it and try again."
        case .invalidResponse:
            return "There is a network problem. Fix it and try again."
        case .networkFailure:
            return "There is a network problem. Fix it and try again."
        }
    }
}

@MainActor
final class AIChatVoiceRecorder: NSObject, AIChatVoiceRecording {
    private var recorder: AVAudioRecorder?
    private var currentFileUrl: URL?

    func startRecording() async throws {
        if AVAudioSession.sharedInstance().recordPermission == .denied {
            throw AIChatVoiceRecorderError.microphoneDenied
        }

        if AVAudioSession.sharedInstance().recordPermission == .undetermined {
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
            mediaType: "audio/m4a"
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
        throw AIChatTranscriptionError.networkFailure
    }
}

private struct AIChatTranscriptionResponse: Decodable {
    let text: String
}

final class AIChatTranscriptionService {
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
                throw AIChatTranscriptionError.invalidResponse
            }

            guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
                throw AIChatTranscriptionError.invalidResponse
            }

            let transcriptionResponse = try self.decoder.decode(AIChatTranscriptionResponse.self, from: data)
            return transcriptionResponse.text
        } catch let error as AIChatTranscriptionError {
            throw error
        } catch {
            throw AIChatTranscriptionError.networkFailure
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

func mergeAIChatDictationTranscript(draft: String, transcript: String) -> String {
    let trimmedTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedTranscript.isEmpty == false else {
        return draft
    }

    let prefix = draft.isEmpty || draft.last?.isWhitespace == true ? "" : " "
    let suffix = trimmedTranscript.last?.isWhitespace == true ? "" : " "
    return draft + prefix + trimmedTranscript + suffix
}
