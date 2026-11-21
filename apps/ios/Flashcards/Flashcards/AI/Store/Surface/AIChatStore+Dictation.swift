import Foundation

extension AIChatStore {
    func toggleDictation() {
        guard self.isChatInteractive else {
            return
        }
        guard self.serverChatConfig.features.dictationEnabled || self.dictationState != .idle else {
            return
        }

        switch self.dictationState {
        case .idle:
            guard self.canStartDictation else {
                return
            }
            guard self.hasExternalProviderConsent else {
                self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                return
            }
            self.startDictation()
        case .recording:
            guard self.canUseDictation else {
                return
            }
            guard self.hasExternalProviderConsent else {
                self.cancelDictation()
                self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                return
            }
            self.finishDictation()
        case .requestingPermission, .transcribing:
            return
        }
    }

    func cancelDictation() {
        // A recording has no task in flight — the start task finished the moment `.recording` was
        // set — so cancelling one observes nothing and would leave `dictation_started` unpaired.
        // `.requestingPermission` has reported no start yet and `.transcribing` reports from its own
        // task, so this is the only state that reports from here and one attempt yields one event.
        if self.dictationState == .recording {
            Analytics.track(.dictationFailed(reason: .cancelled), screen: .ai)
        }
        self.activeDictationTask?.cancel()
        self.activeDictationTask = nil
        self.voiceRecorder.cancelRecording()
        self.dictationState = .idle
        self.completedDictationTranscript = nil
    }

    func startDictation() {
        guard self.canStartDictation else {
            return
        }
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.activeAlert = nil
        self.completedDictationTranscript = nil
        self.dictationState = .requestingPermission
        self.activeDictationTask = Task { @MainActor in
            defer {
                if Task.isCancelled == false {
                    self.activeDictationTask = nil
                    if self.dictationState == .requestingPermission {
                        self.dictationState = .idle
                    }
                }
            }

            do {
                try Task.checkCancellation()
                try await self.voiceRecorder.startRecording()
                try Task.checkCancellation()
                guard self.hasExternalProviderConsent else {
                    self.voiceRecorder.cancelRecording()
                    throw CancellationError()
                }
                self.dictationState = .recording
                // The recorder is running, which is what `dictation_started` means. Reporting the
                // button tap instead would count a microphone refusal as a start.
                Analytics.track(.dictationStarted)
            } catch where Task.isCancelled || error is CancellationError {
                Analytics.track(.dictationFailed(reason: .cancelled), screen: .ai)
            } catch let recorderError as AIChatVoiceRecorderError {
                Analytics.track(
                    .dictationFailed(reason: analyticsDictationFailureReason(error: recorderError)),
                    screen: .ai
                )
                self.handleStartDictationError(recorderError)
            } catch {
                Analytics.track(
                    .dictationFailed(reason: analyticsDictationFailureReason(error: error)),
                    screen: .ai
                )
                self.showGeneralError(error: error)
            }
        }
    }

    func finishDictation() {
        if self.dictationState != .recording {
            return
        }

        self.dictationState = .transcribing
        let foregroundProvisioningSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.preemptPendingNewSessionProvisioningForForegroundSessionProvisioning(
            sessionId: foregroundProvisioningSessionId
        )
        self.activeDictationTask = Task { @MainActor in
            defer {
                if Task.isCancelled == false {
                    self.activeDictationTask = nil
                    self.dictationState = .idle
                }
            }

            do {
                try Task.checkCancellation()
                // Release the microphone before cloud session preparation can suspend.
                let recordedAudio = try await self.voiceRecorder.stopRecording()
                defer {
                    try? FileManager.default.removeItem(at: recordedAudio.fileUrl)
                }

                try Task.checkCancellation()
                // Reports no `dictation_failed`, and neither does the identical guard on the start
                // path: external-provider consent is answered on its own prompt and gates the whole
                // AI surface, so it is a precondition of dictation rather than an outcome of it.
                guard self.hasExternalProviderConsent else {
                    self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                    return
                }
                let session = try await self.flashcardsStore.cloudSessionForAI()
                try Task.checkCancellation()
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)

                try Task.checkCancellation()
                _ = try self.flashcardsStore.aiConsent.requireReceipt(session: session)
                let transcription = try await self.audioTranscriber.transcribe(
                    session: session,
                    sessionId: explicitSessionId,
                    recordedAudio: recordedAudio
                )
                try Task.checkCancellation()
                _ = try self.flashcardsStore.aiConsent.requireReceipt(session: session)
                guard transcription.sessionId == explicitSessionId else {
                    throw LocalStoreError.validation(
                        "AI dictation returned an unexpected session id. expected=\(explicitSessionId) actual=\(transcription.sessionId)"
                    )
                }
                self.schedulePersistCurrentState()
                self.completedDictationTranscript = AIChatCompletedDictationTranscript(
                    id: UUID().uuidString.lowercased(),
                    transcript: transcription.text
                )
            } catch where Task.isCancelled || error is CancellationError {
                Analytics.track(.dictationFailed(reason: .cancelled), screen: .ai)
            } catch let recorderError as AIChatVoiceRecorderError {
                Analytics.track(
                    .dictationFailed(reason: analyticsDictationFailureReason(error: recorderError)),
                    screen: .ai
                )
                self.handleFinishDictationError(recorderError)
            } catch let transcriptionError as AIChatTranscriptionError {
                Analytics.track(
                    .dictationFailed(reason: analyticsDictationFailureReason(error: transcriptionError)),
                    screen: .ai
                )
                switch transcriptionError {
                case .aiLimitReached where self.usesGuestAIRestrictions:
                    await self.appendStandaloneAssistantAccountUpgradePromptAndPersist(
                        message: aiChatGuestLimitReachedMessage(),
                        buttonTitle: aiChatGuestQuotaButtonTitle
                    )
                case .aiLimitReached:
                    self.showAccountAILimitReachedError()
                default:
                    self.showGeneralError(error: transcriptionError)
                }
            } catch {
                Analytics.track(
                    .dictationFailed(reason: analyticsDictationFailureReason(error: error)),
                    screen: .ai
                )
                self.showGeneralError(error: error)
            }
        }
    }

    func handleStartDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .microphoneDenied:
            return
        case .microphoneBlocked:
            self.showMicrophoneSettingsAlert()
        default:
            self.showGeneralError(error: error)
        }
    }

    func handleFinishDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .emptyRecording:
            return
        case .microphoneBlocked:
            self.showMicrophoneSettingsAlert()
        default:
            self.showGeneralError(error: error)
        }
    }
}
