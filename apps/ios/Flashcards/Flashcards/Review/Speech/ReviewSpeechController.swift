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

    override init() {
        super.init()
        self.synthesizer.delegate = self
    }

    func toggleSpeech(
        side: ReviewSpeechSide,
        sourceText: String,
        fallbackLanguageTag: String
    ) -> String? {
        let speakableText = makeReviewSpeakableText(text: sourceText)
        if speakableText.isEmpty {
            return nil
        }

        if self.activeSide == side && self.synthesizer.isSpeaking {
            self.stopSpeech()
            return nil
        }

        self.stopSpeech()

        let languageTag = detectReviewSpeechLanguage(
            text: speakableText,
            fallbackLanguageTag: fallbackLanguageTag
        )

        guard let voice = selectReviewSpeechVoice(languageTag: languageTag) else {
            return reviewSpeechUnavailableBannerMessage
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

        let utterance = AVSpeechUtterance(string: speakableText)
        utterance.voice = voice

        self.activeSide = side
        self.synthesizer.speak(utterance)
        return nil
    }

    func stopSpeech() {
        self.activeSide = nil
        if self.synthesizer.isSpeaking || self.synthesizer.isPaused {
            self.synthesizer.stopSpeaking(at: .immediate)
        } else {
            self.deactivateReviewSpeechAudioSession()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.activeSide = nil
            self.deactivateReviewSpeechAudioSession()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.activeSide = nil
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
