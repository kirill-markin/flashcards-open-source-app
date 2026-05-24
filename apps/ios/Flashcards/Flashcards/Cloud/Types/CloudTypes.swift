import Foundation

let workspaceResetProgressConfirmationText: String = String(
    localized: "workspace.reset_progress_confirmation_text",
    table: "Foundation",
    comment: "Confirmation phrase for resetting all workspace card progress"
)

enum CloudAccountState: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case disconnected
    case linkingReady = "linking-ready"
    case guest
    case linked

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .disconnected:
            return String(
                localized: "cloud_account_state.disconnected.title",
                table: "Foundation",
                comment: "Cloud account state title for disconnected"
            )
        case .linkingReady:
            return String(
                localized: "cloud_account_state.linking_ready.title",
                table: "Foundation",
                comment: "Cloud account state title for linking ready"
            )
        case .guest:
            return String(
                localized: "cloud_account_state.guest.title",
                table: "Foundation",
                comment: "Cloud account state title for guest"
            )
        case .linked:
            return String(
                localized: "cloud_account_state.linked.title",
                table: "Foundation",
                comment: "Cloud account state title for linked"
            )
        }
    }
}

enum CloudAuthorization: Hashable, Sendable {
    case bearer(String)
    case guest(String)

    var headerValue: String {
        switch self {
        case .bearer(let token):
            return "Bearer \(token)"
        case .guest(let token):
            return "Guest \(token)"
        }
    }

    var isGuest: Bool {
        switch self {
        case .guest:
            return true
        case .bearer:
            return false
        }
    }
}

struct CloudLinkedSession: Hashable, Sendable {
    let userId: String
    let workspaceId: String
    let email: String?
    let configurationMode: CloudServiceConfigurationMode
    let apiBaseUrl: String
    let authorization: CloudAuthorization

    var authorizationHeaderValue: String {
        self.authorization.headerValue
    }

    var bearerToken: String {
        switch self.authorization {
        case .bearer(let token):
            return token
        case .guest:
            preconditionFailure("Bearer token is unavailable for guest cloud sessions")
        }
    }
}

struct CloudWorkspaceSummary: Codable, Identifiable, Hashable, Sendable {
    let workspaceId: String
    let name: String
    let createdAt: String
    let isSelected: Bool

    var id: String {
        workspaceId
    }
}

struct CloudWorkspaceDeletePreview: Codable, Hashable, Sendable {
    let workspaceId: String
    let workspaceName: String
    let activeCardCount: Int
    let confirmationText: String
    let isLastAccessibleWorkspace: Bool
}

struct CloudWorkspaceDeleteResult: Codable, Hashable, Sendable {
    let ok: Bool
    let deletedWorkspaceId: String
    let deletedCardsCount: Int
    let workspace: CloudWorkspaceSummary
}

// Keep in sync with the backend workspace reset-progress routes and the other
// client implementations.
struct CloudWorkspaceResetProgressPreview: Codable, Hashable, Sendable {
    let workspaceId: String
    let workspaceName: String
    let cardsToResetCount: Int
    let confirmationText: String

    var id: String {
        self.workspaceId
    }
}

struct CloudWorkspaceResetProgressResult: Codable, Hashable, Sendable {
    let ok: Bool
    let workspaceId: String
    let cardsResetCount: Int
}

struct CloudWorkspaceLinkContext: Hashable, Identifiable, Sendable {
    let userId: String
    let email: String?
    let apiBaseUrl: String
    let credentials: StoredCloudCredentials
    let workspaces: [CloudWorkspaceSummary]
    let guestUpgradeMode: CloudGuestUpgradeMode?
    let postAuthRecoveryRoute: CloudPostAuthRecoveryRoute

    var id: String {
        userId
    }
}

enum CloudPostAuthRecoveryRoute: Hashable, Sendable {
    case none
    case linkedCredentialRestore
    case guestLocalRecovery
    case pendingGuestUpgradeRecovery
}

struct CloudVerifiedAuthContext: Hashable {
    let apiBaseUrl: String
    let credentials: StoredCloudCredentials
}

enum CloudWorkspaceLinkSelection: Hashable, Sendable {
    case existing(workspaceId: String)
    case createNew
}

enum CloudServiceConfigurationMode: String, Codable, Hashable, Sendable {
    case official
    case custom
}

struct CloudServerOverride: Codable, Hashable, Sendable {
    let customOrigin: String
}

struct CloudServiceConfiguration: Hashable {
    let mode: CloudServiceConfigurationMode
    let customOrigin: String?
    let apiBaseUrl: String
    let authBaseUrl: String
}

struct CloudOtpChallenge: Hashable {
    let email: String
    let csrfToken: String
    let otpSessionToken: String
}

struct StoredCloudCredentials: Codable, Hashable {
    let refreshToken: String
    let idToken: String
    let idTokenExpiresAt: String
}

enum CloudSendCodeResult: Hashable {
    case otpChallenge(CloudOtpChallenge)
    case verifiedCredentials(StoredCloudCredentials)
}

struct StoredGuestCloudSession: Codable, Hashable, Sendable {
    let guestToken: String
    let userId: String
    let workspaceId: String
    let configurationMode: CloudServiceConfigurationMode
    let apiBaseUrl: String
}

enum CloudGuestUpgradeMode: String, Codable, Hashable, Sendable {
    case bound
    case mergeRequired = "merge_required"
}

enum CloudGuestUpgradeSelection: Hashable, Sendable {
    case existing(workspaceId: String)
    case createNew
}

enum CloudCredentialRecoveryReason: String, Codable, Hashable, Sendable {
    case linkedCredentialsMissing = "linked_credentials_missing"
    case guestSessionMissing = "guest_session_missing"
    case invalidStoredState = "invalid_stored_state"
}

struct CloudCredentialRecoveryState: Codable, Hashable, Sendable {
    let reason: CloudCredentialRecoveryReason
    let previousCloudState: CloudAccountState
    let installationId: String
    let linkedUserId: String?
    let linkedWorkspaceId: String?
    let activeWorkspaceId: String?
    let linkedEmail: String?
    let configurationMode: CloudServiceConfigurationMode
    let apiBaseUrl: String
    let detectedAt: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case reason
        case previousCloudState
        case installationId
        case linkedUserId
        case linkedWorkspaceId
        case activeWorkspaceId
        case linkedEmail
        case configurationMode
        case apiBaseUrl
        case detectedAt
    }

    init(
        reason: CloudCredentialRecoveryReason,
        previousCloudState: CloudAccountState,
        installationId: String,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        activeWorkspaceId: String?,
        linkedEmail: String?,
        configurationMode: CloudServiceConfigurationMode,
        apiBaseUrl: String,
        detectedAt: String
    ) {
        self.reason = reason
        self.previousCloudState = previousCloudState
        self.installationId = installationId
        self.linkedUserId = linkedUserId
        self.linkedWorkspaceId = linkedWorkspaceId
        self.activeWorkspaceId = activeWorkspaceId
        self.linkedEmail = linkedEmail
        self.configurationMode = configurationMode
        self.apiBaseUrl = apiBaseUrl
        self.detectedAt = detectedAt
    }

    init(from decoder: Decoder) throws {
        let unknownKeyContainer = try decoder.container(keyedBy: CloudCredentialRecoveryUnknownCodingKey.self)
        let allowedKeys = Set(Self.CodingKeys.allCases.map(\.stringValue))
        let unknownKeys = Set(unknownKeyContainer.allKeys.map(\.stringValue)).subtracting(allowedKeys)
        guard unknownKeys.isEmpty else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Cloud credential recovery state contains unknown keys: \(unknownKeys.sorted().joined(separator: ", "))"
                )
            )
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.reason = try container.decode(CloudCredentialRecoveryReason.self, forKey: .reason)
        self.previousCloudState = try container.decode(CloudAccountState.self, forKey: .previousCloudState)
        self.installationId = try container.decode(String.self, forKey: .installationId)
        self.linkedUserId = try container.decodeIfPresent(String.self, forKey: .linkedUserId)
        self.linkedWorkspaceId = try container.decodeIfPresent(String.self, forKey: .linkedWorkspaceId)
        self.activeWorkspaceId = try container.decodeIfPresent(String.self, forKey: .activeWorkspaceId)
        self.linkedEmail = try container.decodeIfPresent(String.self, forKey: .linkedEmail)
        self.configurationMode = try container.decode(CloudServiceConfigurationMode.self, forKey: .configurationMode)
        self.apiBaseUrl = try container.decode(String.self, forKey: .apiBaseUrl)
        self.detectedAt = try container.decode(String.self, forKey: .detectedAt)
    }
}

private struct CloudCredentialRecoveryUnknownCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        _ = intValue
        return nil
    }
}

struct CloudIdentityToken: Hashable {
    let idToken: String
    let idTokenExpiresAt: String
}

struct CloudSettings: Codable, Hashable, Sendable {
    let installationId: String
    let cloudState: CloudAccountState
    let linkedUserId: String?
    let linkedWorkspaceId: String?
    let activeWorkspaceId: String?
    let linkedEmail: String?
    let onboardingCompleted: Bool
    let updatedAt: String
}

struct AgentApiKeyConnection: Codable, Hashable, Identifiable, Sendable {
    let connectionId: String
    let label: String
    let createdAt: String
    let lastUsedAt: String?
    let revokedAt: String?

    var id: String {
        self.connectionId
    }
}
