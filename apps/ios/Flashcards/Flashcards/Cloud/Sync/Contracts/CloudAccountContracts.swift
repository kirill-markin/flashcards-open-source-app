/*
 Keep sync wire contracts aligned with:
 - apps/backend/src/sync/contracts/input.ts
 - apps/backend/src/sync/contracts/types.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/remote/sync/CloudSyncRemoteApi.kt
 */

struct MeResponse: Decodable {
    struct Profile: Decodable {
        let email: String?
    }

    struct Preferences: Decodable {
        let reviewReactionAnimationsEnabled: Bool
        let productAnalyticsEnabled: Bool?
        let firstReviewOnboardingCompleted: Bool
        let accentColor: AccountAccentColor
    }

    let userId: String
    let canonicalAccountId: String?
    let linkedAccountIds: [String]?
    let selectedWorkspaceId: String?
    let profile: Profile
    let preferences: Preferences
    /// Absent on older backends, which keeps the active config.
    let reviewPrompts: ReviewPromptRemoteConfigJSON?
}

struct WorkspacesResponse: Decodable {
    let workspaces: [CloudWorkspaceSummary]
    let nextCursor: String?
}

struct WorkspaceEnvelope: Decodable {
    let workspace: CloudWorkspaceSummary
}

struct AgentApiKeyConnectionsEnvelope: Decodable {
    let connections: [AgentApiKeyConnection]
    let nextCursor: String?
    let instructions: String
}

struct AgentApiKeyRevokeEnvelope: Decodable {
    let ok: Bool
    let connection: AgentApiKeyConnection
    let instructions: String
}

struct CreateWorkspaceRequest: Encodable {
    let name: String
}

struct DeleteAccountRequest: Encodable {
    let confirmationText: String
}

struct DeleteAccountResponse: Decodable {
    let ok: Bool
}

struct UpdateAccountPreferencesResponse: Decodable {
    let preferences: AccountPreferences
}

struct CloudAccountIdentity: Hashable, Sendable {
    let originalUserId: String
    let canonicalAccountId: String?
    let linkedAccountIds: [String]?

    func localContinuityUserId(cloudSettings: CloudSettings) -> String {
        guard cloudSettings.cloudState == .linked,
            let localUserId = cloudSettings.linkedUserId,
            localUserId.isEmpty == false else {
            return self.originalUserId
        }
        if localUserId == self.originalUserId {
            return localUserId
        }

        // Only the authenticated /me alias set can preserve a different local owner.
        guard let canonicalAccountId = self.canonicalAccountId,
            canonicalAccountId.isEmpty == false,
            let linkedAccountIds = self.linkedAccountIds,
            linkedAccountIds.contains(self.originalUserId),
            linkedAccountIds.contains(canonicalAccountId),
            linkedAccountIds.contains(localUserId) else {
            return self.originalUserId
        }
        return localUserId
    }
}
