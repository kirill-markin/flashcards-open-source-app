import Foundation

extension AIChatStore {
    var currentCustomInstructionsScope: AIChatCustomInstructionsScope? {
        guard self.flashcardsStore.cloudSettings?.cloudState == .linked,
              let userId = self.flashcardsStore.cloudSettings?.linkedUserId,
              let workspaceId = self.flashcardsStore.workspace?.workspaceId else {
            return nil
        }
        return AIChatCustomInstructionsScope(userId: userId, workspaceId: workspaceId)
    }

    /// Nil while the current account and workspace have no known value yet.
    var currentCustomInstructionsReading: AIChatCustomInstructionsReading? {
        guard let scope = self.currentCustomInstructionsScope else {
            return nil
        }
        return self.customInstructionsReadings[scope]
    }

    /// Keeps the newest reading per scope, so a late response for an older request or workspace changes nothing current.
    func applyCustomInstructionsReading(_ reading: AIChatCustomInstructionsReading?) {
        guard let reading else {
            return
        }
        if let current = self.customInstructionsReadings[reading.scope], current.observedAt >= reading.observedAt {
            return
        }
        self.customInstructionsReadings[reading.scope] = reading
    }

    func loadCustomInstructions() async throws -> (
        response: AIChatCustomInstructionsResponse,
        scope: AIChatCustomInstructionsScope
    ) {
        guard let scope = self.currentCustomInstructionsScope else {
            throw CancellationError()
        }
        let session = try await self.customInstructionsSession(for: scope)
        let requestedAt = ContinuousClock.now
        let response = try await self.chatService.loadCustomInstructions(session: session)
        let reading = AIChatCustomInstructionsReading(
            session: session,
            text: response.customInstructions,
            observedAt: requestedAt
        )
        self.applyCustomInstructionsReading(reading)
        return (response, reading.scope)
    }

    /// Blank text clears the value. A draft loaded for another account or workspace is never saved over the
    /// current one: the save is cancelled and the editor reloads for the new scope.
    func saveCustomInstructions(
        text: String,
        loadedScope: AIChatCustomInstructionsScope
    ) async throws -> AIChatCustomInstructionsResponse {
        let session = try await self.customInstructionsSession(for: loadedScope)
        let isBlank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let response = try await self.chatService.saveCustomInstructions(
            session: session,
            customInstructions: isBlank ? nil : text
        )
        self.applyCustomInstructionsReading(AIChatCustomInstructionsReading(
            session: session,
            text: response.customInstructions,
            observedAt: ContinuousClock.now
        ))
        return response
    }

    private func customInstructionsSession(for scope: AIChatCustomInstructionsScope) async throws -> CloudLinkedSession {
        guard self.currentCustomInstructionsScope == scope else {
            throw CancellationError()
        }
        if case .blocked(let message) = self.flashcardsStore.syncStatus {
            throw LocalStoreError.validation(message)
        }
        let session = try await self.flashcardsStore.prepareAuthenticatedCloudSessionForAI()
        guard self.currentCustomInstructionsScope == scope,
              session.userId == scope.userId,
              session.workspaceId == scope.workspaceId else {
            throw CancellationError()
        }
        return session
    }
}
