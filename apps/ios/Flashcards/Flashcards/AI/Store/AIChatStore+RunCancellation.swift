import Foundation

func shouldAttemptRemoteAIChatStop(
    initialComposerPhase: AIChatComposerPhase,
    hadActiveSendTask: Bool,
    stopRunId: String?
) -> Bool {
    if aiChatNonEmptyRunId(runId: stopRunId) != nil {
        return true
    }

    if hadActiveSendTask {
        return true
    }

    switch initialComposerPhase {
    case .startingRun, .running:
        return true
    case .idle, .preparingSend, .stopping:
        return false
    }
}

func makeAIChatStopFailureMetadata(
    error: Error,
    sessionId: String,
    runId: String?,
    workspaceId: String?,
    cloudState: CloudAccountState?,
    configurationMode: CloudServiceConfigurationMode?
) -> [String: String] {
    var metadata: [String: String] = [
        "chatSessionId": sessionId,
        "failureKind": "stop_request_failed",
        "errorSummary": Flashcards.errorMessage(error: error)
    ]

    if let runId = aiChatNonEmptyRunId(runId: runId) {
        metadata["runId"] = runId
    }
    if let workspaceId, workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
        metadata["workspaceId"] = workspaceId
    }
    if let cloudState {
        metadata["cloudState"] = cloudState.rawValue
    }
    if let configurationMode {
        metadata["configurationMode"] = configurationMode.rawValue
    }

    if let diagnosticError = error as? any AIChatFailureDiagnosticProviding {
        let diagnostics = diagnosticError.diagnostics
        metadata["clientRequestId"] = diagnostics.clientRequestId
        metadata["stage"] = diagnostics.stage.rawValue
        metadata["errorKind"] = diagnostics.errorKind.rawValue
        if let backendRequestId = diagnostics.backendRequestId,
           backendRequestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
        if let statusCode = diagnostics.statusCode {
            metadata["statusCode"] = String(statusCode)
        }
    }

    if let serviceError = error as? AIChatServiceError,
       case .invalidResponse(let errorDetails, _, _) = serviceError {
        if let backendCode = errorDetails.code,
           backendCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendCode"] = backendCode
        }
        if metadata["backendRequestId"] == nil,
           let backendRequestId = errorDetails.requestId,
           backendRequestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
    }

    return metadata
}

extension AIChatStore {
    func cancelStreaming() {
        let stopRunId: String? = aiChatNonEmptyRunId(runId: self.activeRunId)
        let initialComposerPhase = self.composerPhase
        let hadActiveSendTask = self.activeSendTask != nil
        let shouldAttemptRemoteStop = shouldAttemptRemoteAIChatStop(
            initialComposerPhase: initialComposerPhase,
            hadActiveSendTask: hadActiveSendTask,
            stopRunId: stopRunId
        )
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        Task {
            await self.runtime.detach()
        }
        if shouldAttemptRemoteStop {
            self.transitionToStopping(runId: stopRunId)
        } else {
            self.transitionToIdle()
        }
        self.repairStatus = nil
        self.clearOptimisticAssistantStatusIfNeeded()

        let sessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = sessionId
        self.conversationScopeId = sessionId
        guard shouldAttemptRemoteStop else {
            return
        }
        guard sessionId.isEmpty == false else {
            self.transitionToIdle()
            self.schedulePersistCurrentState()
            return
        }

        Task {
            var stopSession: CloudLinkedSession?
            defer {
                if self.composerPhase == .stopping {
                    self.transitionToIdle()
                }
                self.schedulePersistCurrentState()
            }
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                stopSession = session
                let stopResponse = try await self.chatService.stopRun(
                    session: session,
                    sessionId: sessionId,
                    runId: stopRunId
                )
                // The cancel-cleanup branches below mutate state for the run we
                // were stopping. If composerPhase moved off .stopping (e.g. a
                // new run started or transitionToIdle already ran) the
                // response is stale and must not clobber the new state.
                guard self.composerPhase == .stopping else {
                    return
                }
                if stopResponse.stopped == false {
                    self.transitionToIdle()
                    self.startLinkedBootstrap(forceReloadState: true, resumeAttemptDiagnostics: nil)
                    return
                }
                if stopResponse.stopped, stopResponse.stillRunning == false {
                    self.finalizeStoppedAssistantMessageIfNeeded()
                    self.activeStreamingMessageId = nil
                    self.activeStreamingItemId = nil
                    self.transitionToIdle()
                    self.repairStatus = nil
                }
            } catch {
                logAIChatStoreEvent(
                    action: "ai_stop_failed",
                    metadata: makeAIChatStopFailureMetadata(
                        error: error,
                        sessionId: sessionId,
                        runId: stopRunId,
                        workspaceId: stopSession?.workspaceId ?? self.flashcardsStore.workspace?.workspaceId,
                        cloudState: self.flashcardsStore.cloudSettings?.cloudState,
                        configurationMode: stopSession?.configurationMode
                    )
                )
            }
        }
    }
}

func isAIChatRequestCancellationError(error: Error) -> Bool {
    isRequestCancellationError(error: error)
}
