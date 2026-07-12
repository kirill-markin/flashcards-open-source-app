import Foundation

private let linkedWorkspaceUnavailableErrorCode: String = "WORKSPACE_NOT_FOUND"

func isLinkedWorkspaceUnavailableCloudSyncResponse(
    error: Error,
    linkedSession: CloudLinkedSession,
    cloudSettings: CloudSettings?
) -> Bool {
    guard linkedSession.authorization.isGuest == false else {
        return false
    }
    guard let cloudSettings, cloudSettings.cloudState == .linked else {
        return false
    }
    guard cloudSettings.linkedUserId == linkedSession.userId else {
        return false
    }
    let expectedWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
    guard expectedWorkspaceId == linkedSession.workspaceId else {
        return false
    }
    guard let syncError = error as? CloudSyncError,
        case .invalidResponse(let details, let statusCode) = syncError else {
        return false
    }

    return statusCode == 404 && details.code == linkedWorkspaceUnavailableErrorCode
}

@MainActor
extension FlashcardsStore {
    @discardableResult
    func enterLinkedWorkspaceUnavailableRecoveryIfNeeded(
        error: Error,
        linkedSession: CloudLinkedSession,
        detectedAt: Date
    ) async throws -> Bool {
        guard isLinkedWorkspaceUnavailableCloudSyncResponse(
            error: error,
            linkedSession: linkedSession,
            cloudSettings: self.cloudSettings
        ) else {
            return false
        }

        await self.cloudRuntime.waitForActiveCloudSyncToSettle()

        if let recoveryState = self.cloudCredentialRecoveryState {
            guard recoveryState.reason == .linkedWorkspaceUnavailable else {
                return false
            }
            self.blockCloudSyncForCredentialRecovery()
            return true
        }

        guard let cloudSettings = self.cloudSettings,
            isLinkedWorkspaceUnavailableCloudSyncResponse(
                error: error,
                linkedSession: linkedSession,
                cloudSettings: cloudSettings
            ) else {
            return false
        }
        let configuration = try self.currentCloudServiceConfiguration()
        try self.markCloudCredentialRecoveryRequired(
            reason: .linkedWorkspaceUnavailable,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: detectedAt
        )
        return true
    }
}
