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
    }

    let userId: String
    let selectedWorkspaceId: String?
    let profile: Profile
    let preferences: Preferences
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
