import Foundation

/**
 * The official service answers on more than one API host: the configured one and the legacy host
 * that already-shipped builds call. Both front the same backend and the same database, so a stored
 * record stamped with either host names the same service, the same account and the same workspace.
 *
 * Both hosts are listed, so the equivalence holds whichever of them a build is configured with, and
 * a record is never rewritten toward a host outside that list.
 *
 * Stored records are canonicalized to the configured host as they are read. An install that created
 * its credentials against the legacy host therefore keeps them, reaches the configured host, and
 * matches every later identity comparison exactly, instead of being read as a different service and
 * having its session cleared.
 *
 * A custom server is a different service: it is compared by exact origin and never rewritten.
 */
private let officialCloudApiBaseUrls: Set<String> = [
    "https://api.nibomo.com/v1",
    "https://api.flashcards-open-source-app.com/v1"
]

/**
 * Every API base URL a record stored for this configuration may carry: the configured one first,
 * then, for the official service, the other official hosts. For stores keyed by the URL itself,
 * where a record cannot be canonicalized on read because the key is how it is found.
 */
func equivalentStoredCloudApiBaseUrls(configuration: CloudServiceConfiguration) -> [String] {
    guard configuration.mode == .official,
        officialCloudApiBaseUrls.contains(configuration.apiBaseUrl) else {
        return [configuration.apiBaseUrl]
    }

    return [configuration.apiBaseUrl] + officialCloudApiBaseUrls
        .filter { $0 != configuration.apiBaseUrl }
        .sorted()
}

private func canonicalCloudApiBaseUrl(
    storedApiBaseUrl: String,
    storedMode: CloudServiceConfigurationMode,
    configuration: CloudServiceConfiguration
) -> String {
    guard storedMode == .official,
        configuration.mode == .official,
        officialCloudApiBaseUrls.contains(storedApiBaseUrl),
        officialCloudApiBaseUrls.contains(configuration.apiBaseUrl) else {
        return storedApiBaseUrl
    }

    return configuration.apiBaseUrl
}

func canonicalizedStoredGuestCloudSession(
    session: StoredGuestCloudSession,
    configuration: CloudServiceConfiguration
) -> StoredGuestCloudSession {
    let canonicalApiBaseUrl = canonicalCloudApiBaseUrl(
        storedApiBaseUrl: session.apiBaseUrl,
        storedMode: session.configurationMode,
        configuration: configuration
    )
    guard canonicalApiBaseUrl != session.apiBaseUrl else {
        return session
    }

    return StoredGuestCloudSession(
        guestToken: session.guestToken,
        userId: session.userId,
        workspaceId: session.workspaceId,
        configurationMode: session.configurationMode,
        apiBaseUrl: canonicalApiBaseUrl
    )
}

func canonicalizedCloudCredentialRecoveryState(
    state: CloudCredentialRecoveryState,
    configuration: CloudServiceConfiguration
) -> CloudCredentialRecoveryState {
    let canonicalApiBaseUrl = canonicalCloudApiBaseUrl(
        storedApiBaseUrl: state.apiBaseUrl,
        storedMode: state.configurationMode,
        configuration: configuration
    )
    guard canonicalApiBaseUrl != state.apiBaseUrl else {
        return state
    }

    return CloudCredentialRecoveryState(
        reason: state.reason,
        previousCloudState: state.previousCloudState,
        installationId: state.installationId,
        linkedUserId: state.linkedUserId,
        linkedWorkspaceId: state.linkedWorkspaceId,
        activeWorkspaceId: state.activeWorkspaceId,
        linkedEmail: state.linkedEmail,
        configurationMode: state.configurationMode,
        apiBaseUrl: canonicalApiBaseUrl,
        detectedAt: state.detectedAt
    )
}

func canonicalizedGuestLocalRecoveryWorkspaceCheckpoint(
    checkpoint: GuestLocalRecoveryWorkspaceCheckpoint,
    configuration: CloudServiceConfiguration
) -> GuestLocalRecoveryWorkspaceCheckpoint {
    let canonicalApiBaseUrl = canonicalCloudApiBaseUrl(
        storedApiBaseUrl: checkpoint.apiBaseUrl,
        storedMode: checkpoint.configurationMode,
        configuration: configuration
    )
    guard canonicalApiBaseUrl != checkpoint.apiBaseUrl else {
        return checkpoint
    }

    return GuestLocalRecoveryWorkspaceCheckpoint(
        userId: checkpoint.userId,
        apiBaseUrl: canonicalApiBaseUrl,
        configurationMode: checkpoint.configurationMode,
        recoveryDetectedAt: checkpoint.recoveryDetectedAt,
        workspace: checkpoint.workspace
    )
}

func canonicalizedPendingGuestUpgradeState(
    state: PendingGuestUpgradeState,
    configuration: CloudServiceConfiguration
) -> PendingGuestUpgradeState {
    let canonicalApiBaseUrl = canonicalCloudApiBaseUrl(
        storedApiBaseUrl: state.common.apiBaseUrl,
        storedMode: state.common.configurationMode,
        configuration: configuration
    )
    guard canonicalApiBaseUrl != state.common.apiBaseUrl else {
        return state
    }

    let canonicalCommon = PendingGuestUpgradeCommonState(
        schemaVersion: state.common.schemaVersion,
        apiBaseUrl: canonicalApiBaseUrl,
        configurationMode: state.common.configurationMode,
        userId: state.common.userId,
        email: state.common.email,
        preferences: state.common.preferences
    )

    switch state {
    case .inFlight(let inFlightState):
        return .inFlight(
            PendingGuestUpgradeInFlightState(
                common: canonicalCommon,
                guestIdentity: inFlightState.guestIdentity,
                selection: inFlightState.selection,
                supportsDroppedEntities: inFlightState.supportsDroppedEntities
            )
        )
    case .completed(let completedState):
        return .completed(
            PendingGuestUpgradeCompletedState(
                common: canonicalCommon,
                workspace: completedState.workspace
            )
        )
    }
}
