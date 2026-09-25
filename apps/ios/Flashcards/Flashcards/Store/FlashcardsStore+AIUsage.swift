import Foundation

@MainActor
extension FlashcardsStore {
    /// The usage last read for the identity that is current now, if any.
    var currentAIMonthlyUsage: AIMonthlyUsage? {
        guard let snapshot = self.aiUsageSnapshot,
              let userId = self.cloudSettings?.linkedUserId,
              snapshot.userId == userId else {
            return nil
        }

        return snapshot.usage
    }

    /**
     Reads `GET /me/ai-usage` for the current identity. A guest install is read only once its guest session
     exists, so opening the chat never creates a guest account just to count messages. A failed read keeps
     the last value and leaves only a breadcrumb: it runs on every chat open and after every turn, and the
     count only informs and never gates AI.
     */
    func refreshAIUsage() async {
        do {
            let session: CloudLinkedSession
            switch self.cloudSettings?.cloudState {
            case .linked:
                try self.throwIfCloudCredentialRecoveryRequired()
                session = try await self.prepareAuthenticatedCloudSessionForAI()
            case .guest:
                guard let guestSession = self.cloudRuntime.activeCloudSession() else {
                    return
                }
                session = guestSession
            case .disconnected, .linkingReady, nil:
                return
            }

            let usage = try await loadAIMonthlyUsage(
                urlSession: URLSession.shared,
                session: session
            )
            self.aiUsageSnapshot = AIUsageSnapshot(userId: session.userId, usage: usage)
        } catch {
            if isRequestCancellationError(error: error) || isSilentlyIgnorableNetworkTransportFailure(error: error) {
                return
            }

            var metadata: [String: String] = ["error": Flashcards.errorMessage(error: error)]
            if case .responseNotOk(let statusCode, let errorDetails)? = error as? AIUsageRequestError {
                metadata["statusCode"] = String(statusCode)
                metadata["backendCode"] = errorDetails.code
                metadata["backendRequestId"] = errorDetails.requestId
            }
            metadata["workspaceId"] = self.workspace?.workspaceId
            if let cloudState = self.cloudSettings?.cloudState {
                metadata["cloudState"] = cloudState.rawValue
            }
            logAIChatStoreEvent(action: "ai_usage_refresh_failed", metadata: metadata)
        }
    }
}
