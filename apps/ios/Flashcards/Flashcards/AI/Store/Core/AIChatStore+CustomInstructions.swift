import Foundation

extension AIChatStore {
    var currentCustomInstructionsScope: AIChatCustomInstructionsScope? {
        guard let settings = self.flashcardsStore.cloudSettings,
              settings.cloudState == .linked || settings.cloudState == .guest,
              let userId = settings.linkedUserId, userId.isEmpty == false,
              let workspaceId = settings.activeWorkspaceId ?? settings.linkedWorkspaceId,
              self.flashcardsStore.workspace?.workspaceId == workspaceId else {
            return nil
        }
        let isGuest = settings.cloudState == .guest
        let generation = self.flashcardsStore.cloudRuntime.syncGeneration
        guard self.flashcardsStore.cloudRuntime.isCurrentSyncGeneration(generation),
              isGuest == false || (self.flashcardsStore.isGuestUpgradeBlockingLocalOutboxMutations == false
                  && self.flashcardsStore.isCloudCredentialRecoveryRequired == false) else {
            return nil
        }
        return AIChatCustomInstructionsScope(
            userId: userId,
            workspaceId: workspaceId,
            isGuest: isGuest,
            syncGeneration: generation
        )
    }

    var currentCustomInstructionsReading: AIChatCustomInstructionsReading? {
        guard let reading = self.customInstructionsReading,
              reading.scope == self.currentCustomInstructionsScope else {
            return nil
        }
        return reading
    }

    func applyCustomInstructionsReading(_ reading: AIChatCustomInstructionsReading?) {
        guard let reading, reading.scope == self.currentCustomInstructionsScope else {
            return
        }
        if let current = self.customInstructionsReading,
           current.scope == reading.scope, current.observedAt >= reading.observedAt {
            return
        }
        self.customInstructionsReading = reading
    }

    func loadCustomInstructions(scope: AIChatCustomInstructionsScope) async throws -> AIChatCustomInstructionsResponse {
        let session = try await self.customInstructionsSession(for: scope)
        try self.checkCustomInstructionsSession(session, scope: scope)
        let requestedAt = ContinuousClock.now
        let response = try await self.chatService.loadCustomInstructions(session: session)
        try self.checkCustomInstructionsSession(session, scope: scope)
        self.applyCustomInstructionsReading(AIChatCustomInstructionsReading(
            scope: scope,
            text: response.customInstructions,
            observedAt: requestedAt
        ))
        return response
    }

    func saveCustomInstructions(
        text: String,
        loadedScope: AIChatCustomInstructionsScope
    ) async throws {
        let session = try await self.customInstructionsSession(for: loadedScope)
        try self.checkCustomInstructionsSession(session, scope: loadedScope)
        let isBlank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let response = try await self.chatService.saveCustomInstructions(
            session: session,
            customInstructions: isBlank ? nil : text
        )
        try self.checkCustomInstructionsSession(session, scope: loadedScope)
        self.applyCustomInstructionsReading(AIChatCustomInstructionsReading(
            scope: loadedScope,
            text: response.customInstructions,
            observedAt: ContinuousClock.now
        ))
    }

    private func customInstructionsSession(for scope: AIChatCustomInstructionsScope) async throws -> CloudLinkedSession {
        try Task.checkCancellation()
        guard self.currentCustomInstructionsScope == scope else {
            throw CancellationError()
        }
        if case .blocked(let message) = self.flashcardsStore.syncStatus {
            throw LocalStoreError.validation(message)
        }
        let session: CloudLinkedSession
        if scope.isGuest {
            try self.flashcardsStore.throwIfCloudCredentialRecoveryRequired()
            try self.flashcardsStore.throwIfCustomGuestWorkspacePaused()
            guard let guest = try self.flashcardsStore.loadUsableGuestSessionForCurrentConfiguration(),
                  guest.userId == scope.userId,
                  guest.workspaceId == scope.workspaceId else {
                throw LocalStoreError.uninitialized("Guest cloud session is unavailable for the current workspace")
            }
            guard let existingSession = try await self.flashcardsStore.cloudSessionForAccountContextRefresh() else {
                throw CancellationError()
            }
            session = existingSession
        } else {
            session = try await self.flashcardsStore.cloudSessionForAI()
        }
        return session
    }

    private func checkCustomInstructionsSession(
        _ session: CloudLinkedSession,
        scope: AIChatCustomInstructionsScope
    ) throws {
        try self.flashcardsStore.cloudRuntime.checkSyncGeneration(scope.syncGeneration)
        try self.flashcardsStore.cloudRuntime.checkCurrentLinkedSyncSession(linkedSession: session)
        guard self.currentCustomInstructionsScope == scope,
              session.userId == scope.userId,
              session.workspaceId == scope.workspaceId,
              session.authorization.isGuest == scope.isGuest else {
            throw CancellationError()
        }
    }
}
