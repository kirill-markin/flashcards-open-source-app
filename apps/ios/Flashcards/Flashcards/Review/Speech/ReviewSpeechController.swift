import AVFAudio
import Combine
import Foundation

private let reviewCardsStringsTableName: String = "ReviewCards"

@MainActor
final class ReviewSpeechController: NSObject, ObservableObject, @preconcurrency AVSpeechSynthesizerDelegate {
    /// The side the user asked to hear; set on tap, before preparation finishes, so the button reflects the request.
    @Published private(set) var activeSide: ReviewSpeechSide? = nil

    private let synthesizer = AVSpeechSynthesizer()
    private var hasRequestedSpeech: Bool = false
    private let audioSession = ReviewSpeechAudioSession()
    private var playbackGeneration: Int = 0
    private var finalUtterance: AVSpeechUtterance? = nil

    override init() {
        super.init()
        self.synthesizer.delegate = self
    }

    func toggleSpeech(
        side: ReviewSpeechSide,
        sourceText: String,
        fallbackLanguageTag: String,
        onError: @escaping @MainActor (String) -> Void
    ) {
        let segments = makeReviewSpeechSegments(
            text: makeReviewSpeakableText(text: sourceText),
            fallbackLanguageTag: fallbackLanguageTag
        )
        if segments.isEmpty {
            return
        }

        if self.activeSide == side {
            self.stopSpeech()
            return
        }

        self.stopSpeech()
        self.activeSide = side
        let generation = self.playbackGeneration

        Task { @MainActor in
            let utterances: [AVSpeechUtterance]
            do {
                utterances = try await self.audioSession.prepareUtterances(segments: segments)
            } catch {
                if generation != self.playbackGeneration {
                    return
                }

                self.activeSide = nil
                self.audioSession.deactivate()
                onError(makeReviewSpeechPreparationErrorMessage(error: error))
                return
            }

            if generation != self.playbackGeneration {
                // A stop or a newer tap superseded this playback; a pending newer playback owns the session.
                if self.activeSide == nil {
                    self.audioSession.deactivate()
                }
                return
            }

            self.finalUtterance = utterances.last
            self.hasRequestedSpeech = true
            for utterance in utterances {
                self.synthesizer.speak(utterance)
            }
        }
    }

    func stopSpeech() {
        self.playbackGeneration += 1
        self.activeSide = nil
        self.finalUtterance = nil
        if self.hasRequestedSpeech == false {
            self.audioSession.deactivate()
            return
        }

        if self.synthesizer.isSpeaking || self.synthesizer.isPaused {
            self.synthesizer.stopSpeaking(at: .immediate)
        } else {
            self.audioSession.deactivate()
        }
    }

    /// The identity check runs synchronously: the non-Sendable utterance must not cross into a Task, and checking it
    /// later could end a playback that a tap started in between.
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if utterance !== self.finalUtterance {
            return
        }

        self.activeSide = nil
        self.finalUtterance = nil
        // Deactivate one hop later so the synthesizer's audio I/O has stopped; a playback started meanwhile owns the session.
        Task { @MainActor in
            if self.finalUtterance != nil || self.activeSide != nil {
                return
            }

            self.audioSession.deactivate()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // Only `stopSpeech` cancels; a replacement playback, even one still preparing, owns the session.
            if self.finalUtterance != nil || self.activeSide != nil {
                return
            }

            self.audioSession.deactivate()
        }
    }
}

private enum ReviewSpeechPreparationError: Error {
    case voiceUnavailable
    case audioSessionUnavailable
}

private func makeReviewSpeechPreparationErrorMessage(error: any Error) -> String {
    if case ReviewSpeechPreparationError.voiceUnavailable = error {
        return reviewSpeechUnavailableBannerMessage
    }

    return String(
        localized: "Couldn't prepare audio for speech. Check your audio settings and try again.",
        table: reviewCardsStringsTableName
    )
}

/// `AVAudioSession.setActive` blocks and voice lookup can be slow, so both run off the main thread on one serial
/// queue; activations and deactivations therefore never overlap and apply in the order the main actor requested them.
private final class ReviewSpeechAudioSession: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ReviewSpeechAudioSession", qos: .userInitiated)
    /// Read and written only on `queue`.
    private var isActive: Bool = false

    func prepareUtterances(segments: [ReviewSpeechSegment]) async throws -> sending [AVSpeechUtterance] {
        try await withCheckedThrowingContinuation { continuation in
            self.queue.async {
                var utterances: [AVSpeechUtterance] = []
                for segment in segments {
                    guard let voice = selectReviewSpeechVoice(languageTag: segment.languageTag) else {
                        continuation.resume(throwing: ReviewSpeechPreparationError.voiceUnavailable)
                        return
                    }

                    let utterance = AVSpeechUtterance(string: segment.text)
                    utterance.voice = voice
                    utterances.append(utterance)
                }

                do {
                    try self.activate()
                } catch {
                    continuation.resume(throwing: ReviewSpeechPreparationError.audioSessionUnavailable)
                    return
                }
                continuation.resume(returning: utterances)
            }
        }
    }

    func deactivate() {
        self.queue.async {
            if self.isActive == false {
                return
            }

            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                // Keep deactivation best-effort so review UI never fails on stop/cancel cleanup.
            }
            self.isActive = false
        }
    }

    private func activate() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(
            .playback,
            mode: .spokenAudio,
            options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
        )
        if self.isActive {
            return
        }

        try audioSession.setActive(true)
        self.isActive = true
    }
}
