import AVFAudio
import Combine
import Foundation

private let reviewCardsStringsTableName: String = "ReviewCards"

@MainActor
final class ReviewSpeechController: NSObject, ObservableObject, @preconcurrency AVSpeechSynthesizerDelegate {
    @Published private(set) var activeSide: ReviewSpeechSide? = nil

    private let synthesizer = AVSpeechSynthesizer()
    private let audioSession = AVAudioSession.sharedInstance()
    private var isAudioSessionActive: Bool = false
    /// Last queued utterance of the current playback; nil when nothing of ours is playing.
    private var finalUtterance: AVSpeechUtterance? = nil

    override init() {
        super.init()
        self.synthesizer.delegate = self
    }

    func toggleSpeech(
        side: ReviewSpeechSide,
        sourceText: String,
        fallbackLanguageTag: String
    ) -> String? {
        let segments = makeReviewSpeechSegments(
            text: makeReviewSpeakableText(text: sourceText),
            fallbackLanguageTag: fallbackLanguageTag
        )
        if segments.isEmpty {
            return nil
        }

        if self.activeSide == side && self.synthesizer.isSpeaking {
            self.stopSpeech()
            return nil
        }

        self.stopSpeech()

        var utterances: [AVSpeechUtterance] = []
        for segment in segments {
            guard let voice = selectReviewSpeechVoice(languageTag: segment.languageTag) else {
                return reviewSpeechUnavailableBannerMessage
            }

            let utterance = AVSpeechUtterance(string: segment.text)
            utterance.voice = voice
            utterances.append(utterance)
        }

        do {
            try self.configureReviewSpeechAudioSession()
            try self.activateReviewSpeechAudioSession()
        } catch {
            self.deactivateReviewSpeechAudioSession()
            return String(
                localized: "Couldn't prepare audio for speech. Check your audio settings and try again.",
                table: reviewCardsStringsTableName
            )
        }

        self.activeSide = side
        self.finalUtterance = utterances.last
        for utterance in utterances {
            self.synthesizer.speak(utterance)
        }
        return nil
    }

    func stopSpeech() {
        self.activeSide = nil
        self.finalUtterance = nil
        if self.synthesizer.isSpeaking || self.synthesizer.isPaused {
            self.synthesizer.stopSpeaking(at: .immediate)
        } else {
            self.deactivateReviewSpeechAudioSession()
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

            self.deactivateReviewSpeechAudioSession()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // Only `stopSpeech` cancels; when a replacement playback has already started, it owns the session.
            if self.finalUtterance != nil {
                return
            }

            self.deactivateReviewSpeechAudioSession()
        }
    }

    private func configureReviewSpeechAudioSession() throws {
        try self.audioSession.setCategory(
            .playback,
            mode: .spokenAudio,
            options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
        )
    }

    private func activateReviewSpeechAudioSession() throws {
        if self.isAudioSessionActive {
            return
        }

        try self.audioSession.setActive(true)
        self.isAudioSessionActive = true
    }

    private func deactivateReviewSpeechAudioSession() {
        if self.isAudioSessionActive == false {
            return
        }

        do {
            try self.audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            // Keep deactivation best-effort so review UI never fails on stop/cancel cleanup.
        }
        self.isAudioSessionActive = false
    }
}
