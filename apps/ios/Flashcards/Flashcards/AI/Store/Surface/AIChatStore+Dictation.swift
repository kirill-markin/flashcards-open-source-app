import AVFoundation
import SwiftUI
import UIKit

let aiChatDictationWaveformSampleCount: Int = 64
private let aiChatDictationMeteringInterval: Duration = .milliseconds(80)
/// A shorter interrupted recording is discarded rather than transcribed.
private let aiChatDictationMinimumInterruptedDurationSeconds: TimeInterval = 1

/// One dictation attempt. Its identity is its ownership: a cancelled or superseded attempt finds itself no longer
/// current and leaves the store, the recorder and the draft to the newer one.
@MainActor
final class AIChatDictationAttempt {
    /// The draft text and caret when dictation began; the transcript goes there while that text is unchanged.
    let draftText: String
    let insertionSelection: AIChatDictationInsertionSelection?
    var restoresComposerFocus: Bool
    /// Warms the AI session while the person speaks, so Finish rarely waits on the network.
    var provisioningTask: Task<Void, Error>?
    var hasStartedRecording: Bool
    var recordedDurationSeconds: TimeInterval

    init(draftText: String, insertionSelection: AIChatDictationInsertionSelection?, restoresComposerFocus: Bool) {
        self.draftText = draftText
        self.insertionSelection = insertionSelection
        self.restoresComposerFocus = restoresComposerFocus
        self.provisioningTask = nil
        self.hasStartedRecording = false
        self.recordedDurationSeconds = 0
    }
}

/// What the composer shows of dictation beyond its phase. Levels change on every metering tick, so only the waveform
/// reads them.
@MainActor
@Observable
final class AIChatDictationRuntime {
    var inlineErrorMessage: String?
    var elapsedSeconds: Int
    var levels: [CGFloat]
    @ObservationIgnored var attempt: AIChatDictationAttempt?
    @ObservationIgnored var meteringTask: Task<Void, Never>?
    @ObservationIgnored var lifecycleObservers: [NSObjectProtocol]
    @ObservationIgnored var disablesIdleTimer: Bool

    init() {
        self.inlineErrorMessage = nil
        self.elapsedSeconds = 0
        self.levels = Array(repeating: 0, count: aiChatDictationWaveformSampleCount)
        self.attempt = nil
        self.meteringTask = nil
        self.lifecycleObservers = []
        self.disablesIdleTimer = false
    }
}

extension AIChatStore {
    /// Starts an attempt. The caller closes the keyboard once the state leaves idle; `restoresComposerFocus` brings
    /// it back after the transcript lands.
    func startDictation(restoresComposerFocus: Bool = false) {
        guard self.canStartDictation else {
            return
        }
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.activeAlert = nil
        self.dictationRuntime.inlineErrorMessage = nil
        self.completedDictationTranscript = nil
        let attempt = AIChatDictationAttempt(
            draftText: self.inputText,
            insertionSelection: aiChatDictationInsertionSelection(text: self.inputText, selection: self.composerSelection),
            restoresComposerFocus: restoresComposerFocus
        )
        self.beginDictationAttempt(attempt)
        self.dictationState = .requestingPermission
        attempt.provisioningTask = self.makeDictationProvisioningTask(attempt: attempt)
        self.activeDictationTask = Task { @MainActor in
            await self.runDictationStart(attempt: attempt)
        }
    }

    /// Stops the microphone, then transcribes into the draft. Dictation never sends.
    func finishDictation() {
        self.finishDictation(restoresComposerFocus: nil)
    }

    func finishDictation(restoresComposerFocus: Bool?) {
        guard self.dictationState == .recording else {
            return
        }

        let attempt = self.dictationRuntime.attempt ?? self.adoptDictationAttempt()
        if let restoresComposerFocus {
            attempt.restoresComposerFocus = restoresComposerFocus
        }
        self.stopDictationRecordingActivity()
        self.dictationState = .transcribing
        self.preemptPendingNewSessionProvisioningForForegroundSessionProvisioning(
            sessionId: aiChatResolvedSessionId(workspaceId: self.historyWorkspaceId(), sessionId: self.chatSessionId)
        )
        self.activeDictationTask = Task { @MainActor in
            await self.runDictationFinish(attempt: attempt)
        }
    }

    /// Discards the attempt in any phase. Its in-flight work finds itself no longer current and touches nothing.
    func cancelDictation() {
        // A recording has no task in flight, so it reports its own cancellation here. The permission and
        // transcription phases report from their tasks, so one attempt yields one event.
        if self.dictationState == .recording {
            Analytics.track(.dictationFailed(reason: .cancelled), screen: .ai)
        }
        self.activeDictationTask?.cancel()
        self.voiceRecorder.cancelRecording()
        self.endDictationAttempt()
        if self.dictationRuntime.inlineErrorMessage != nil {
            self.dictationRuntime.inlineErrorMessage = nil
        }
        if self.completedDictationTranscript != nil {
            self.completedDictationTranscript = nil
        }
    }

    func dismissDictationError() {
        self.dictationRuntime.inlineErrorMessage = nil
    }

    /// Leaving the chat finishes a recording into the draft; the scene going inactive, as under the microphone
    /// permission alert, changes nothing. Backgrounding discards through its own notification.
    func updateDictationSurface(activity: AIChatSurfaceActivity) {
        guard self.dictationState != .idle else {
            return
        }
        guard activity.hasExternalProviderConsent else {
            self.cancelDictation()
            return
        }
        guard activity.isAITabSelected == false else {
            return
        }
        self.leaveDictationForNavigation()
    }

    /// Leaving the live chat finishes a recording into the draft and abandons a pending permission request.
    func leaveDictationForNavigation() {
        switch self.dictationState {
        case .idle:
            return
        case .requestingPermission:
            self.cancelDictation()
        case .recording:
            self.finishDictation(restoresComposerFocus: false)
        case .transcribing:
            self.dictationRuntime.attempt?.restoresComposerFocus = false
        }
    }

    private func runDictationStart(attempt: AIChatDictationAttempt) async {
        do {
            try await self.voiceRecorder.startRecording()
            guard self.isCurrentDictationAttempt(attempt) else {
                // A newer attempt that already records owns the recorder; otherwise this stale one must let it go.
                if self.dictationRuntime.attempt?.hasStartedRecording != true {
                    self.voiceRecorder.cancelRecording()
                }
                throw CancellationError()
            }
            guard self.hasExternalProviderConsent else {
                self.voiceRecorder.cancelRecording()
                throw CancellationError()
            }
            attempt.hasStartedRecording = true
            self.activeDictationTask = nil
            self.dictationState = .recording
            // The recorder is running, which is what `dictation_started` means. Reporting the button tap instead
            // would count a microphone refusal as a start.
            Analytics.track(.dictationStarted)
            self.startDictationRecordingActivity(attempt: attempt)
            postAIChatDictationAnnouncement(
                aiSettingsLocalized("ai.composer.dictation.announcement.started", "Recording started"),
                isAlert: false
            )
        } catch {
            await self.failDictation(attempt: attempt, error: error)
        }
    }

    private func runDictationFinish(attempt: AIChatDictationAttempt) async {
        // A cancel that landed first already closed the microphone, and the recorder may now be a newer attempt's.
        guard self.isCurrentDictationAttempt(attempt) else {
            await self.failDictation(attempt: attempt, error: CancellationError())
            return
        }
        let recordedAudio: AIChatRecordedAudio
        do {
            // The microphone closes before anything waits, so no failure and no slow network below keeps it open.
            recordedAudio = try await self.voiceRecorder.stopRecording()
        } catch {
            self.voiceRecorder.cancelRecording()
            await self.failDictation(attempt: attempt, error: error)
            return
        }
        defer {
            try? FileManager.default.removeItem(at: recordedAudio.fileUrl)
        }

        do {
            guard self.isCurrentDictationAttempt(attempt) else {
                throw CancellationError()
            }
            // Reports no `dictation_failed`, as on the start path: consent is answered on its own prompt and gates
            // the whole AI surface, so it is a precondition of dictation rather than an outcome of it.
            guard self.hasExternalProviderConsent else {
                self.endDictationAttempt()
                self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                return
            }
            aiChatDictationLogger.log("event=transcription_preparing microphoneClosed=true")
            // Usually already done while recording; a failure there is retried here with the microphone closed.
            _ = try? await attempt.provisioningTask?.value
            try self.ensureCurrentDictationAttempt(attempt)
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
            try self.ensureCurrentDictationAttempt(attempt)
            _ = try self.flashcardsStore.aiConsent.requireReceipt(session: session)
            let transcription = try await self.audioTranscriber.transcribe(
                session: session,
                sessionId: explicitSessionId,
                recordedAudio: recordedAudio
            )
            try self.ensureCurrentDictationAttempt(attempt)
            _ = try self.flashcardsStore.aiConsent.requireReceipt(session: session)
            guard transcription.sessionId == explicitSessionId else {
                throw LocalStoreError.validation(
                    "AI dictation returned an unexpected session id. expected=\(explicitSessionId) actual=\(transcription.sessionId)"
                )
            }
            self.schedulePersistCurrentState()
            self.endDictationAttempt()
            self.insertDictationTranscript(transcription.text, attempt: attempt)
        } catch {
            await self.failDictation(attempt: attempt, error: error)
        }
    }

    /// Reports the failure once. Only the current attempt changes state or shows anything, and an abandoned request
    /// never surfaces as an error.
    private func failDictation(attempt: AIChatDictationAttempt, error: Error) async {
        let isCurrent = self.isCurrentDictationAttempt(attempt)
        let isCancellation = isRequestCancellationError(error: error)
        Analytics.track(
            .dictationFailed(
                reason: isCurrent && isCancellation == false ? analyticsDictationFailureReason(error: error) : .cancelled
            ),
            screen: .ai
        )
        guard isCurrent else {
            return
        }

        self.endDictationAttempt()
        guard isCancellation == false else {
            return
        }

        switch error {
        case let recorderError as AIChatVoiceRecorderError:
            switch recorderError {
            case .microphoneDenied:
                return
            case .microphoneBlocked:
                self.showMicrophoneSettingsAlert()
            default:
                self.captureUserVisibleAIChatFailure(error: recorderError)
                self.showDictationError(message: Flashcards.errorMessage(error: recorderError))
            }
        case AIChatTranscriptionError.aiLimitReached where self.usesGuestAIRestrictions:
            await self.appendStandaloneAssistantAccountUpgradePromptAndPersist(
                message: aiChatGuestLimitReachedMessage(),
                buttonTitle: aiChatGuestQuotaButtonTitle
            )
        case AIChatTranscriptionError.aiLimitReached:
            self.showDictationError(message: self.accountAILimitReachedMessage())
        default:
            self.captureUserVisibleAIChatFailure(error: error)
            self.showDictationError(message: aiChatGeneralErrorMessage(error: error))
        }
    }

    private func showDictationError(message: String) {
        self.dictationRuntime.inlineErrorMessage = message
        postAIChatDictationAnnouncement(message, isAlert: true)
    }

    /// The caret captured at the start still fits an unchanged draft. A draft that changed meanwhile takes the
    /// transcript at its end instead, so a transcript is never dropped.
    private func insertDictationTranscript(_ transcript: String, attempt: AIChatDictationAttempt) {
        guard transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            self.showDictationError(message: Flashcards.errorMessage(error: AIChatVoiceRecorderError.emptyRecording))
            return
        }

        let draft = self.inputText
        let beforeCount = draft.utf16.count
        let insertionResult = insertAIChatDictationTranscript(
            draft: draft,
            transcript: transcript,
            selection: draft == attempt.draftText ? attempt.insertionSelection : nil
        )
        self.recordComposerEditing(
            operation: .dictation,
            phase: .before,
            beforeUTF16Count: beforeCount,
            afterUTF16Count: insertionResult.text.utf16.count
        )
        self.inputText = insertionResult.text
        self.composerSelection = aiChatTextSelection(text: insertionResult.text, selection: insertionResult.selection)
        self.recordComposerEditing(
            operation: .dictation,
            phase: .after,
            beforeUTF16Count: beforeCount,
            afterUTF16Count: insertionResult.text.utf16.count
        )
        if attempt.restoresComposerFocus {
            self.completedDictationTranscript = AIChatCompletedDictationTranscript(
                id: UUID().uuidString.lowercased(),
                selection: insertionResult.selection
            )
        }
        postAIChatDictationAnnouncement(
            aiSettingsLocalized("ai.composer.dictation.announcement.inserted", "Transcript added"),
            isAlert: false
        )
    }

    private func makeDictationProvisioningTask(attempt: AIChatDictationAttempt) -> Task<Void, Error> {
        self.preemptPendingNewSessionProvisioningForForegroundSessionProvisioning(
            sessionId: aiChatResolvedSessionId(workspaceId: self.historyWorkspaceId(), sessionId: self.chatSessionId)
        )
        return Task { @MainActor in
            let session = try await self.flashcardsStore.cloudSessionForAI()
            // A cancelled attempt must not provision a session for whatever chat replaced it.
            try self.ensureCurrentDictationAttempt(attempt)
            _ = try await self.ensureRemoteSessionIfNeeded(session: session)
        }
    }

    private func isCurrentDictationAttempt(_ attempt: AIChatDictationAttempt) -> Bool {
        self.dictationRuntime.attempt === attempt
    }

    private func ensureCurrentDictationAttempt(_ attempt: AIChatDictationAttempt) throws {
        guard self.isCurrentDictationAttempt(attempt) else {
            throw CancellationError()
        }
    }

    private func beginDictationAttempt(_ attempt: AIChatDictationAttempt) {
        self.dictationRuntime.attempt = attempt
        self.startObservingDictationLifecycle()
    }

    /// A recording set directly, without a start, still gets an owner.
    private func adoptDictationAttempt() -> AIChatDictationAttempt {
        let attempt = AIChatDictationAttempt(draftText: self.inputText, insertionSelection: nil, restoresComposerFocus: false)
        attempt.hasStartedRecording = true
        self.beginDictationAttempt(attempt)
        return attempt
    }

    private func endDictationAttempt() {
        self.dictationRuntime.attempt?.provisioningTask?.cancel()
        self.dictationRuntime.attempt = nil
        self.activeDictationTask = nil
        self.stopDictationRecordingActivity()
        self.stopObservingDictationLifecycle()
        if self.dictationState != .idle {
            self.dictationState = .idle
        }
    }

    private func startDictationRecordingActivity(attempt: AIChatDictationAttempt) {
        let runtime = self.dictationRuntime
        runtime.elapsedSeconds = 0
        runtime.levels = Array(repeating: 0, count: aiChatDictationWaveformSampleCount)
        // A long dictation without touches must not lock the screen, which would background the app and discard it.
        if UIApplication.shared.isIdleTimerDisabled == false {
            UIApplication.shared.isIdleTimerDisabled = true
            runtime.disablesIdleTimer = true
        }
        runtime.meteringTask?.cancel()
        runtime.meteringTask = Task { @MainActor [weak self] in
            while Task.isCancelled == false {
                guard let self else {
                    return
                }
                self.sampleDictationRecording(attempt: attempt)
                try? await Task.sleep(for: aiChatDictationMeteringInterval)
            }
        }
    }

    private func stopDictationRecordingActivity() {
        let runtime = self.dictationRuntime
        runtime.meteringTask?.cancel()
        runtime.meteringTask = nil
        if runtime.disablesIdleTimer {
            UIApplication.shared.isIdleTimerDisabled = false
            runtime.disablesIdleTimer = false
        }
    }

    private func sampleDictationRecording(attempt: AIChatDictationAttempt) {
        guard self.dictationState == .recording,
              self.isCurrentDictationAttempt(attempt),
              let sample = self.voiceRecorder.currentRecordingSample() else {
            return
        }

        let runtime = self.dictationRuntime
        attempt.recordedDurationSeconds = sample.durationSeconds
        let level = normalizeAIChatDictationLevel(decibels: sample.averagePowerDecibels)
        if level != 0 || runtime.levels.contains(where: { $0 != 0 }) {
            runtime.levels = Array(runtime.levels.dropFirst()) + [level]
        }
        let elapsedSeconds = Int(min(sample.durationSeconds, aiChatDictationMaximumDurationSeconds))
        if elapsedSeconds != runtime.elapsedSeconds {
            runtime.elapsedSeconds = elapsedSeconds
        }
        if sample.durationSeconds >= aiChatDictationMaximumDurationSeconds {
            self.finishDictation()
        }
    }

    private func startObservingDictationLifecycle() {
        let runtime = self.dictationRuntime
        guard runtime.lifecycleObservers.isEmpty else {
            return
        }

        let center = NotificationCenter.default
        runtime.lifecycleObservers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
                let interruptionType = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                    .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                guard interruptionType == .began else {
                    return
                }
                MainActor.assumeIsolated {
                    self?.handleDictationInterruption()
                }
            },
            center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.handleDictationInterruption()
                }
            },
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.cancelDictation()
                }
            }
        ]
    }

    private func stopObservingDictationLifecycle() {
        let runtime = self.dictationRuntime
        for observer in runtime.lifecycleObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        runtime.lifecycleObservers = []
    }

    /// A call, Siri or a media reset transcribes what was said; a recording too short to hold speech is discarded.
    private func handleDictationInterruption() {
        guard self.dictationState == .recording, let attempt = self.dictationRuntime.attempt else {
            return
        }

        if attempt.recordedDurationSeconds >= aiChatDictationMinimumInterruptedDurationSeconds {
            self.finishDictation()
            return
        }

        self.cancelDictation()
        self.showDictationError(
            message: aiSettingsLocalized("ai.dictation.error.interrupted", "Recording interrupted")
        )
    }
}

@MainActor
private func postAIChatDictationAnnouncement(_ message: String, isAlert: Bool) {
    var announcement = AttributedString(message)
    announcement.accessibilitySpeechAnnouncementPriority = isAlert ? .high : .default
    AccessibilityNotification.Announcement(announcement).post()
}
