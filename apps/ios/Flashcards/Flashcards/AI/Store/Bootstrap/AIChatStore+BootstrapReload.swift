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
                    forceReloadState: forceReloadState,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                guard self.isCurrentLinkedBootstrapRequest(
                    sequence: requestSequence,
                    accessContext: bootstrapContext
                ) else {
                    return
                }
                if bootstrapResult.requestedSessionId == nil
                    && bootstrapResult.response.sessionId != self.chatSessionId {
                    logAIChatStoreEvent(
                        action: "ai_bootstrap_switched_to_current_chat",
                        metadata: [
                            "previousSessionId": self.chatSessionId,
                            "sessionId": bootstrapResult.response.sessionId,
                        ]
                    )
                    self.showCurrentChatMovingDraft(
                        staleSessionId: self.chatSessionId,
                        draft: self.currentComposerDraft(),
                        response: bootstrapResult.response
                    )
                } else {
                    self.applyBootstrap(bootstrapResult.response)
                }
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
                    self.applyComposerDraft(inputText: "", pendingAttachments: [], operation: .bootstrapReset)
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

    /// Loads the user's current chat without the refused session id and moves the unsent draft into it.
    /// A failed switch keeps the refused chat and its draft, so the next send retries the switch.
    func switchToCurrentChatAfterSessionNotCurrent(
        staleSessionId: String,
        draft: AIChatComposerDraft
    ) {
        let requestSequence = self.beginBootstrapRequestSequence()
        let accessContext = self.surfaceState.activeAccessContext ?? self.currentAccessContext()
        self.bootstrapPhase = .loading
        self.activeBootstrapTask = Task {
            defer {
                if self.isCurrentBootstrapRequest(sequence: requestSequence) {
                    self.activeBootstrapTask = nil
                }
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: nil,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                guard self.isCurrentLinkedBootstrapRequest(
                    sequence: requestSequence,
                    accessContext: accessContext
                ) else {
                    return
                }
                try validateAIChatBootstrapSessionContract(
                    response: response,
                    requestedSessionId: response.sessionId
                )

                self.showCurrentChatMovingDraft(
                    staleSessionId: staleSessionId,
                    draft: draft,
                    response: response
                )
                self.bootstrapPhase = .ready
                self.lastBootstrapFailureWasRetryable = false
                self.attachBootstrapLiveIfNeeded(
                    response: response,
                    session: session,
                    resumeAttemptDiagnostics: nil
                )
                self.showAlert(.generalError(title: aiChatSessionNotCurrentNotice(), message: ""))
            } catch is CancellationError {
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                guard self.isCurrentLinkedBootstrapRequest(
                    sequence: requestSequence,
                    accessContext: accessContext
                ) else {
                    return
                }
                self.bootstrapPhase = .ready
                self.showGeneralError(error: error)
            }
        }
    }

    private func showCurrentChatMovingDraft(
        staleSessionId: String,
        draft: AIChatComposerDraft,
        response: AIChatBootstrapResponse
    ) {
        let workspaceId = self.historyWorkspaceId()
        self.persistDraftStateImmediately(
            workspaceId: workspaceId,
            sessionId: staleSessionId.isEmpty ? nil : staleSessionId,
            draft: AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        self.chatSessionId = response.sessionId
        self.conversationScopeId = response.conversationScopeId
        self.applyBootstrap(response)
        self.applyComposerDraft(
            inputText: draft.inputText,
            pendingAttachments: draft.pendingAttachments,
            operation: .restore
        )
        self.persistDraftRestoreSuppressionSynchronously(
            workspaceId: workspaceId,
            sessionId: response.sessionId,
            isSuppressed: false
        )
        self.persistDraftStateImmediately(
            workspaceId: workspaceId,
            sessionId: response.sessionId,
            draft: draft
        )
        self.persistStateSynchronously(state: self.currentPersistedState())
    }

    /// The server's current chat is its newest unarchived one, so asking for it can return an older chat than the
    /// shown one only while the shown one is not yet provisioned there. A local run resumes its own session's stream,
    /// and a forced reload, such as after a rejected Stop, reloads the chat it was started for.
    private func shouldBootstrapCurrentChat(forceReloadState: Bool) -> Bool {
        forceReloadState == false
            && self.chatSessionId.isEmpty == false
            && self.requiresRemoteSessionProvisioning == false
            && self.composerPhase == .idle
            && self.currentComposerDraft().origin != .aiImport
    }

    private func shouldPreservePendingLocalSessionDraftOnBootstrapFailure() -> Bool {
        let draft = self.currentComposerDraft()
        if draft.origin == .aiImport {
            return true
        }
        return self.chatSessionId.isEmpty == false
            && self.conversationScopeId == self.chatSessionId
            && self.messages.isEmpty
            && self.activeRunId == nil
            && draft.isEmpty == false
    }

    private func loadBootstrapWithBoundedRetry(
        forceReloadState: Bool,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) async throws -> AIChatBootstrapLoadResult {
        let loadsCurrentChat = self.shouldBootstrapCurrentChat(forceReloadState: forceReloadState)
        var attemptNumber = 0
        while true {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let requestedSessionId: String?
                if loadsCurrentChat {
                    requestedSessionId = nil
                } else {
                    requestedSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                }
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: requestedSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                try validateAIChatBootstrapSessionContract(
                    response: bootstrap,
                    requestedSessionId: requestedSessionId ?? bootstrap.sessionId
                )
                return AIChatBootstrapLoadResult(
                    session: session,
                    response: bootstrap,
                    requestedSessionId: requestedSessionId
                )
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
