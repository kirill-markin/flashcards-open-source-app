import Foundation

extension AIChatStore {
    func startLinkedBootstrap(
        forceReloadState: Bool,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        let requestSequence = self.beginBootstrapRequestSequence()
        if forceReloadState {
            self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
            self.restorePersistedState(self.historyStore.loadState())
        }
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.bootstrapPhase = .loading
        self.lastBootstrapFailureWasRetryable = false

        let bootstrapContext = self.surfaceState.activeAccessContext ?? self.currentAccessContext()
        let preservesPendingLocalSessionDraft = self.shouldPreservePendingLocalSessionDraftOnBootstrapFailure()
        self.activeBootstrapTask = Task {
            defer {
                if self.isCurrentBootstrapRequest(sequence: requestSequence) {
                    self.activeBootstrapTask = nil
                }
            }

            do {
                let bootstrapResult = try await self.loadBootstrapWithBoundedRetry(
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                guard self.isCurrentLinkedBootstrapRequest(
                    sequence: requestSequence,
                    accessContext: bootstrapContext
                ) else {
                    return
                }
                self.applyBootstrap(bootstrapResult.response)
                self.bootstrapPhase = .ready
                self.lastBootstrapFailureWasRetryable = false
                self.attachBootstrapLiveIfNeeded(
                    response: bootstrapResult.response,
                    session: bootstrapResult.session,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
            } catch is CancellationError {
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                guard self.isCurrentLinkedBootstrapRequest(
                    sequence: requestSequence,
                    accessContext: bootstrapContext
                ) else {
                    return
                }
                if preservesPendingLocalSessionDraft == false {
                    self.messages = []
                    self.clearOptimisticOutgoingTurnState()
                    let resolvedSessionId = aiChatResolvedSessionId(
                        workspaceId: self.historyWorkspaceId(),
                        sessionId: self.chatSessionId
                    )
                    self.chatSessionId = resolvedSessionId
                    self.conversationScopeId = resolvedSessionId
                    self.applyComposerDraft(inputText: "", pendingAttachments: [])
                    self.schedulePersistCurrentDraftState()
                }
                self.transitionToIdle()
                self.activeAlert = nil
                self.repairStatus = nil
                self.lastBootstrapFailureWasRetryable = aiChatBootstrapShouldRetry(error: error)
                self.bootstrapPhase = .failed(
                    makeAIChatBootstrapErrorPresentation(
                        error: error,
                        showsLocalValidationMessage: self.flashcardsStore.isCloudSyncBlocked
                    )
                )
            }
        }
    }

    func reloadCanonicalConversationAfterAcceptedTerminalEnvelope() {
        let requestSequence = self.beginBootstrapRequestSequence()
        self.activeBootstrapTask = Task {
            defer {
                if self.isCurrentBootstrapRequest(sequence: requestSequence) {
                    self.activeBootstrapTask = nil
                }
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let requestedSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: requestedSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                guard self.isCurrentBootstrapRequest(sequence: requestSequence),
                      self.chatSessionId == requestedSessionId
                else {
                    return
                }
                try validateAIChatBootstrapSessionContract(
                    response: response,
                    requestedSessionId: requestedSessionId
                )
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(
                    response: response,
                    session: session,
                    resumeAttemptDiagnostics: nil
                )
            } catch is CancellationError {
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                guard self.isCurrentBootstrapRequest(sequence: requestSequence) else {
                    return
                }
                self.finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn()
                self.showGeneralError(error: error)
            }
        }
    }

    private func shouldPreservePendingLocalSessionDraftOnBootstrapFailure() -> Bool {
        self.chatSessionId.isEmpty == false
            && self.conversationScopeId == self.chatSessionId
            && self.messages.isEmpty
            && self.activeRunId == nil
            && self.currentComposerDraft().isEmpty == false
    }

    private func loadBootstrapWithBoundedRetry(
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) async throws -> AIChatBootstrapLoadResult {
        var attemptNumber = 0
        while true {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: explicitSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                try validateAIChatBootstrapSessionContract(
                    response: bootstrap,
                    requestedSessionId: explicitSessionId
                )
                return AIChatBootstrapLoadResult(session: session, response: bootstrap)
            } catch {
                let nextAttemptNumber = attemptNumber + 1
                guard aiChatBootstrapAllowsRetry(nextAttemptNumber: nextAttemptNumber, error: error) else {
                    throw error
                }

                let delayNanoseconds = aiChatBootstrapRetryDelay(attemptIndex: attemptNumber)
                var metadata: [String: String] = [
                    "nextAttempt": String(nextAttemptNumber),
                    "delayNanoseconds": String(delayNanoseconds),
                    "error": Flashcards.errorMessage(error: error),
                    "errorType": String(reflecting: type(of: error)),
                ]
                if let resumeAttemptDiagnostics {
                    metadata["resumeAttempt"] = resumeAttemptDiagnostics.headerValue
                }
                for (key, value) in aiChatErrorLogMetadata(error: error) {
                    metadata[key] = value
                }
                logAIChatStoreEvent(action: "ai_bootstrap_retry_scheduled", metadata: metadata)
                attemptNumber = nextAttemptNumber
                try await Task.sleep(nanoseconds: delayNanoseconds)
            }
        }
    }
}
