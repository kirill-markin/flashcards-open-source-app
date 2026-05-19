import Foundation

let pendingGuestUpgradeUserDefaultsKey: String = "pending-guest-upgrade"
private let pendingGuestUpgradeSchemaVersion: Int = 5
private let supportedPendingGuestUpgradeSchemaVersions: Set<Int> = [pendingGuestUpgradeSchemaVersion, 4, 3, 2]

private enum PendingGuestUpgradePhase: String, Codable, Hashable {
    case inFlight = "in_flight"
    case completed
}

enum PendingGuestUpgradeSelection: Codable, Hashable {
    case existing(workspaceId: String)
    case createNew

    private enum CodingKeys: String, CodingKey {
        case type
        case workspaceId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "existing":
            self = .existing(workspaceId: try container.decode(String.self, forKey: .workspaceId))
        case "create_new":
            self = .createNew
        default:
            throw LocalStoreError.database("Unsupported pending guest upgrade selection type: \(type)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .existing(let workspaceId):
            try container.encode("existing", forKey: .type)
            try container.encode(workspaceId, forKey: .workspaceId)
        case .createNew:
            try container.encode("create_new", forKey: .type)
        }
    }
}

struct PendingGuestUpgradeCommonState: Hashable {
    let schemaVersion: Int
    let apiBaseUrl: String
    let configurationMode: CloudServiceConfigurationMode
    let userId: String
    let email: String?
}

struct PendingGuestUpgradeGuestIdentityState: Hashable {
    let userId: String
    let workspaceId: String
}

struct PendingGuestUpgradeInFlightState: Hashable {
    let common: PendingGuestUpgradeCommonState
    let guestIdentity: PendingGuestUpgradeGuestIdentityState
    let selection: PendingGuestUpgradeSelection
    let supportsDroppedEntities: Bool
}

struct PendingGuestUpgradeCompletedState: Hashable {
    let common: PendingGuestUpgradeCommonState
    let workspace: CloudWorkspaceSummary
}

/// UserDefaults stores only the resumable guest-upgrade checkpoint: target
/// cloud identity plus either replay inputs or the completed workspace. The
/// bearer token and guest token stay in secure credential stores and are never
/// persisted in this plaintext payload.
enum PendingGuestUpgradeState: Codable, Hashable {
    case inFlight(PendingGuestUpgradeInFlightState)
    case completed(PendingGuestUpgradeCompletedState)

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case phase
        case apiBaseUrl
        case configurationMode
        case userId
        case email
        case guestUserId
        case guestWorkspaceId
        case selection
        case supportsDroppedEntities
        case workspace
    }

    var common: PendingGuestUpgradeCommonState {
        switch self {
        case .inFlight(let state):
            return state.common
        case .completed(let state):
            return state.common
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        guard supportedPendingGuestUpgradeSchemaVersions.contains(schemaVersion) else {
            throw LocalStoreError.database(
                "Unsupported pending guest upgrade schema version: \(schemaVersion)"
            )
        }

        let common = PendingGuestUpgradeCommonState(
            schemaVersion: schemaVersion,
            apiBaseUrl: try container.decode(String.self, forKey: .apiBaseUrl),
            configurationMode: try container.decode(
                CloudServiceConfigurationMode.self,
                forKey: .configurationMode
            ),
            userId: try container.decode(String.self, forKey: .userId),
            email: try container.decodeIfPresent(String.self, forKey: .email)
        )
        // Schema versions 2 and 3 only persisted completed checkpoints and did
        // not include a phase field, so missing phase normalizes to completed.
        let phase = try container.decodeIfPresent(PendingGuestUpgradePhase.self, forKey: .phase) ?? .completed
        switch phase {
        case .inFlight:
            guard let selection = try container.decodeIfPresent(
                PendingGuestUpgradeSelection.self,
                forKey: .selection
            ) else {
                throw LocalStoreError.database("In-flight pending guest upgrade is missing workspace selection")
            }
            guard let guestUserId = try container.decodeIfPresent(String.self, forKey: .guestUserId),
                  let guestWorkspaceId = try container.decodeIfPresent(String.self, forKey: .guestWorkspaceId) else {
                throw LocalStoreError.database(
                    "In-flight pending guest upgrade is missing guest identity fields. Restart the account upgrade from the original guest workspace before retrying recovery."
                )
            }
            guard let supportsDroppedEntities = try container.decodeIfPresent(
                Bool.self,
                forKey: .supportsDroppedEntities
            ) else {
                throw LocalStoreError.database("In-flight pending guest upgrade is missing capability flags")
            }
            self = .inFlight(
                PendingGuestUpgradeInFlightState(
                    common: common,
                    guestIdentity: PendingGuestUpgradeGuestIdentityState(
                        userId: guestUserId,
                        workspaceId: guestWorkspaceId
                    ),
                    selection: selection,
                    supportsDroppedEntities: supportsDroppedEntities
                )
            )
        case .completed:
            guard let workspace = try container.decodeIfPresent(CloudWorkspaceSummary.self, forKey: .workspace) else {
                throw LocalStoreError.database("Completed pending guest upgrade is missing linked workspace")
            }
            self = .completed(
                PendingGuestUpgradeCompletedState(
                    common: common,
                    workspace: workspace
                )
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let common = self.common
        try container.encode(common.schemaVersion, forKey: .schemaVersion)
        try container.encode(common.apiBaseUrl, forKey: .apiBaseUrl)
        try container.encode(common.configurationMode, forKey: .configurationMode)
        try container.encode(common.userId, forKey: .userId)
        try container.encodeIfPresent(common.email, forKey: .email)

        switch self {
        case .inFlight(let state):
            try container.encode(PendingGuestUpgradePhase.inFlight, forKey: .phase)
            try container.encode(state.guestIdentity.userId, forKey: .guestUserId)
            try container.encode(state.guestIdentity.workspaceId, forKey: .guestWorkspaceId)
            try container.encode(state.selection, forKey: .selection)
            try container.encode(state.supportsDroppedEntities, forKey: .supportsDroppedEntities)
        case .completed(let state):
            try container.encode(PendingGuestUpgradePhase.completed, forKey: .phase)
            try container.encode(state.workspace, forKey: .workspace)
        }
    }
}

enum CloudGuestUpgradeDrainError: LocalizedError {
    case workspaceMismatch(localWorkspaceId: String, guestWorkspaceId: String)
    case pendingGuestOutboxEntries(workspaceId: String)

    var errorDescription: String? {
        switch self {
        case .workspaceMismatch(let localWorkspaceId, let guestWorkspaceId):
            return "Guest upgrade expected workspace \(guestWorkspaceId), but the active local workspace is \(localWorkspaceId)."
        case .pendingGuestOutboxEntries(let workspaceId):
            return "Guest upgrade is waiting for local changes in workspace \(workspaceId) to finish syncing. Try again after cloud sync completes."
        }
    }
}

enum PendingGuestUpgradeLocalMutationError: LocalizedError {
    case blocked

    var errorDescription: String? {
        switch self {
        case .blocked:
            return "Account upgrade is finishing. Wait for the upgrade to complete before making more local changes."
        }
    }
}

func assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade(
    isGuestUpgradeLocalOutboxMutationBlocked: Bool,
    userDefaults: UserDefaults
) throws {
    guard isGuestUpgradeLocalOutboxMutationBlocked == false else {
        throw PendingGuestUpgradeLocalMutationError.blocked
    }
    guard userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey) == nil else {
        throw PendingGuestUpgradeLocalMutationError.blocked
    }
}

func clearPendingGuestUpgradeState(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: pendingGuestUpgradeUserDefaultsKey)
}

private func cloudGuestUpgradeSelection(selection: CloudWorkspaceLinkSelection) -> CloudGuestUpgradeSelection {
    switch selection {
    case .existing(let workspaceId):
        return .existing(workspaceId: workspaceId)
    case .createNew:
        return .createNew
    }
}

private func pendingGuestUpgradeSelection(selection: CloudWorkspaceLinkSelection) -> PendingGuestUpgradeSelection {
    switch selection {
    case .existing(let workspaceId):
        return .existing(workspaceId: workspaceId)
    case .createNew:
        return .createNew
    }
}

func cloudGuestUpgradeSelection(selection: PendingGuestUpgradeSelection) -> CloudGuestUpgradeSelection {
    switch selection {
    case .existing(let workspaceId):
        return .existing(workspaceId: workspaceId)
    case .createNew:
        return .createNew
    }
}

func pendingGuestUpgradeInFlightState(
    linkContext: CloudWorkspaceLinkContext,
    configuration: CloudServiceConfiguration,
    guestSession: StoredGuestCloudSession,
    selection: CloudWorkspaceLinkSelection,
    supportsDroppedEntities: Bool
) -> PendingGuestUpgradeState {
    .inFlight(
        PendingGuestUpgradeInFlightState(
            common: PendingGuestUpgradeCommonState(
                schemaVersion: pendingGuestUpgradeSchemaVersion,
                apiBaseUrl: linkContext.apiBaseUrl,
                configurationMode: configuration.mode,
                userId: linkContext.userId,
                email: linkContext.email
            ),
            guestIdentity: PendingGuestUpgradeGuestIdentityState(
                userId: guestSession.userId,
                workspaceId: guestSession.workspaceId
            ),
            selection: pendingGuestUpgradeSelection(selection: selection),
            supportsDroppedEntities: supportsDroppedEntities
        )
    )
}

func pendingGuestUpgradeCompletedState(
    state: PendingGuestUpgradeInFlightState,
    workspace: CloudWorkspaceSummary
) -> PendingGuestUpgradeCompletedState {
    PendingGuestUpgradeCompletedState(
        common: state.common,
        workspace: workspace
    )
}

func cloudLinkedSession(
    state: PendingGuestUpgradeCompletedState,
    credentials: StoredCloudCredentials
) -> CloudLinkedSession {
    CloudLinkedSession(
        userId: state.common.userId,
        workspaceId: state.workspace.workspaceId,
        email: state.common.email,
        configurationMode: state.common.configurationMode,
        apiBaseUrl: state.common.apiBaseUrl,
        authorization: .bearer(credentials.idToken)
    )
}
