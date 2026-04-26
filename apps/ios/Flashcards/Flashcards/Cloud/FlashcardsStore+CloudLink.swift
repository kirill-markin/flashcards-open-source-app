import Foundation

let pendingGuestUpgradeUserDefaultsKey: String = "pending-guest-upgrade"
private let pendingGuestUpgradeSchemaVersion: Int = 5
private let supportedPendingGuestUpgradeSchemaVersions: Set<Int> = [pendingGuestUpgradeSchemaVersion, 4, 3, 2]

private enum PendingGuestUpgradePhase: String, Codable, Hashable {
    case inFlight = "in_flight"
    case completed
}

private enum PendingGuestUpgradeSelection: Codable, Hashable {
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

private struct PendingGuestUpgradeCommonState: Hashable {
    let schemaVersion: Int
    let apiBaseUrl: String
    let configurationMode: CloudServiceConfigurationMode
    let userId: String
    let email: String?
}

private struct PendingGuestUpgradeGuestIdentityState: Hashable {
    let userId: String
    let workspaceId: String
}

private struct PendingGuestUpgradeInFlightState: Hashable {
    let common: PendingGuestUpgradeCommonState
    let guestIdentity: PendingGuestUpgradeGuestIdentityState
    let selection: PendingGuestUpgradeSelection
    let supportsDroppedEntities: Bool
}

private struct PendingGuestUpgradeCompletedState: Hashable {
    let common: PendingGuestUpgradeCommonState
    let workspace: CloudWorkspaceSummary
}

/// UserDefaults stores only the resumable guest-upgrade checkpoint: target
/// cloud identity plus either replay inputs or the completed workspace. The
/// bearer token and guest token stay in secure credential stores and are never
/// persisted in this plaintext payload.
private enum PendingGuestUpgradeState: Codable, Hashable {
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

private func clearPendingGuestUpgradeState(userDefaults: UserDefaults) {
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

private func cloudGuestUpgradeSelection(selection: PendingGuestUpgradeSelection) -> CloudGuestUpgradeSelection {
    switch selection {
    case .existing(let workspaceId):
        return .existing(workspaceId: workspaceId)
    case .createNew:
        return .createNew
    }
}

private func pendingGuestUpgradeInFlightState(
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

private func pendingGuestUpgradeCompletedState(
    state: PendingGuestUpgradeInFlightState,
    workspace: CloudWorkspaceSummary
) -> PendingGuestUpgradeCompletedState {
    PendingGuestUpgradeCompletedState(
        common: state.common,
        workspace: workspace
    )
}

private func cloudLinkedSession(
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

enum CloudBootstrapEligibilityError: LocalizedError {
    case remoteWorkspaceIsNotEmpty

    var errorDescription: String? {
        switch self {
        case .remoteWorkspaceIsNotEmpty:
            return "Choose a new or empty workspace on this server before uploading the current local data."
        }
    }
}

@MainActor
extension FlashcardsStore {
    func assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade() throws {
        try Flashcards.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade(
            isGuestUpgradeLocalOutboxMutationBlocked: self.isGuestUpgradeLocalOutboxMutationBlocked,
            userDefaults: self.userDefaults
        )
    }

    func validateCustomCloudServer(customOrigin: String) async throws -> CloudServiceConfiguration {
        let configuration = try makeCustomCloudServiceConfiguration(customOrigin: customOrigin)
        try await self.cloudServiceConfigurationValidator.validate(configuration: configuration)
        return configuration
    }

    func applyCustomCloudServer(configuration: CloudServiceConfiguration) throws {
        if configuration.mode != .custom {
            throw LocalStoreError.validation("Custom server configuration is required")
        }

        try self.switchCloudServer(override: CloudServerOverride(customOrigin: try requireCustomOrigin(configuration: configuration)))
    }

    func resetToOfficialCloudServer() throws {
        try self.switchCloudServer(override: nil)
    }

    func sendCloudSignInCode(email: String) async throws -> CloudSendCodeResult {
        let configuration = try self.currentCloudServiceConfiguration()
        let result = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
        self.globalErrorMessage = ""
        return result
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try self.currentCloudServiceConfiguration()
        self.globalErrorMessage = ""
        return try await self.cloudRuntime.verifyCode(
            challenge: challenge,
            code: code,
            configuration: configuration
        )
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        let guestUpgradeMode = try await self.prepareGuestUpgradeModeIfNeeded(verifiedContext: verifiedContext)
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces,
            guestUpgradeMode: guestUpgradeMode
        )
    }

    func completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            guard let workspace = self.workspace else {
                throw LocalStoreError.uninitialized("Workspace is unavailable")
            }

            let linkedWorkspace = try await self.cloudRuntime.selectOrCreateWorkspace(
                linkContext: linkContext,
                selection: selection,
                localWorkspaceName: workspace.name
            )

            if try await self.shouldValidateEmptyRemoteWorkspaceBeforeBootstrap() {
                let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
                let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
                let isWorkspaceEmpty = try await cloudSyncService.isWorkspaceEmptyForBootstrap(
                    apiBaseUrl: linkContext.apiBaseUrl,
                    authorizationHeader: "Bearer \(linkContext.credentials.idToken)",
                    workspaceId: linkedWorkspace.workspaceId,
                    installationId: cloudSettings.installationId
                )
                if isWorkspaceEmpty == false {
                    throw CloudBootstrapEligibilityError.remoteWorkspaceIsNotEmpty
                }
            }

            try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
            let configuration = try self.currentCloudServiceConfiguration()
            try await self.finishCloudLink(
                linkedSession: CloudLinkedSession(
                    userId: linkContext.userId,
                    workspaceId: linkedWorkspace.workspaceId,
                    email: linkContext.email,
                    configurationMode: configuration.mode,
                    apiBaseUrl: linkContext.apiBaseUrl,
                    authorization: .bearer(linkContext.credentials.idToken)
                ),
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
            try self.clearGuestSessionIfNeeded()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
    }

    func completeGuestCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            guard let guestSession = try self.loadGuestSessionForCurrentConfiguration() else {
                throw LocalStoreError.uninitialized("Guest AI session is unavailable")
            }
            guard let guestUpgradeMode = linkContext.guestUpgradeMode else {
                throw LocalStoreError.uninitialized("Guest upgrade context is unavailable")
            }

            let configuration = try self.currentCloudServiceConfiguration()
            let trigger = self.manualCloudSyncTrigger(now: Date())
            await self.blockGuestUpgradeLocalOutboxMutationsBeforeDrain()
            do {
                // Guest upgrade completion only merges already-synced cloud state.
                // Drain normal guest sync first so no pending guest outbox is carried
                // into the linked workspace.
            try await self.drainGuestWorkspaceBeforeUpgrade(
                guestSession: guestSession,
                configuration: configuration,
                trigger: trigger
            )
                try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
                let inFlightState = pendingGuestUpgradeInFlightState(
                    linkContext: linkContext,
                    configuration: configuration,
                    guestSession: guestSession,
                    selection: selection,
                    supportsDroppedEntities: guestUpgradeMode == .mergeRequired
                )
                try self.savePendingGuestUpgradeState(state: inFlightState)

                let completionState = try await self.completePendingGuestUpgradeIfNeeded(state: inFlightState)
                try await self.finalizePendingGuestUpgradeCompletion(
                    state: completionState,
                    trigger: trigger
                )
                self.unblockGuestUpgradeLocalOutboxMutationsIfPossible()
                return completionState.workspace
            } catch {
                self.unblockGuestUpgradeLocalOutboxMutationsIfPossible()
                throw error
            }
        }
    }

    func resumePendingGuestUpgradeIfNeeded(trigger: CloudSyncTrigger) async throws -> Bool {
        guard try self.loadPendingGuestUpgradeState() != nil else {
            return false
        }

        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            return try await self.performPendingGuestUpgradeResume(trigger: trigger)
        }
        return true
    }

    private func performPendingGuestUpgradeResume(trigger: CloudSyncTrigger) async throws -> CloudWorkspaceSummary {
        guard let pendingState = try self.loadPendingGuestUpgradeState() else {
            throw LocalStoreError.uninitialized("Pending guest upgrade state is unavailable")
        }

        let completionState = try await self.completePendingGuestUpgradeIfNeeded(state: pendingState)
        try await self.finalizePendingGuestUpgradeCompletion(state: completionState, trigger: trigger)
        return completionState.workspace
    }

    private func drainGuestWorkspaceBeforeUpgrade(
        guestSession: StoredGuestCloudSession,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        guard context.workspaceId == guestSession.workspaceId else {
            throw CloudGuestUpgradeDrainError.workspaceMismatch(
                localWorkspaceId: context.workspaceId,
                guestWorkspaceId: guestSession.workspaceId
            )
        }

        let linkedSession = CloudLinkedSession(
            userId: guestSession.userId,
            workspaceId: guestSession.workspaceId,
            email: nil,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            authorization: .guest(guestSession.guestToken)
        )

        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        self.syncStatus = .syncing
        do {
            let syncResult = try await self.runFreshLinkedSyncAfterActiveSyncSettles(
                linkedSession: linkedSession
            )
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            let database = try requireLocalDatabase(database: self.database)
            let remainingOutboxEntries = try database.loadOutboxEntries(
                workspaceId: guestSession.workspaceId,
                limit: 1
            )
            if remainingOutboxEntries.isEmpty == false {
                throw CloudGuestUpgradeDrainError.pendingGuestOutboxEntries(
                    workspaceId: guestSession.workspaceId
                )
            }
        } catch {
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    private func finalizePendingGuestUpgradeCompletion(
        state: PendingGuestUpgradeCompletedState,
        trigger: CloudSyncTrigger
    ) async throws {
        let credentials = try await self.loadPendingGuestUpgradeCredentials(commonState: state.common)
        let linkedSession = cloudLinkedSession(state: state, credentials: credentials)

        try await self.finishCompletedGuestCloudLink(
            linkedSession: linkedSession,
            workspace: state.workspace,
            trigger: trigger
        )

        try self.clearGuestSessionIfNeeded()
        self.clearPendingGuestUpgradeStateAndUnblockMutations()
        self.globalErrorMessage = ""
    }

    private func blockGuestUpgradeLocalOutboxMutationsBeforeDrain() async {
        self.isGuestUpgradeLocalOutboxMutationBlocked = true
        await self.reviewSubmissionOutboxMutationGate.blockNewReviewSubmissionsAndWaitForActiveSubmissions()
    }

    private func unblockGuestUpgradeLocalOutboxMutationsIfPossible() {
        if self.userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey) == nil {
            self.reviewSubmissionOutboxMutationGate.unblockReviewSubmissions()
        }
        self.isGuestUpgradeLocalOutboxMutationBlocked = false
    }

    func clearPendingGuestUpgradeStateAndUnblockMutations() {
        clearPendingGuestUpgradeState(userDefaults: self.userDefaults)
        self.isGuestUpgradeLocalOutboxMutationBlocked = false
        self.reviewSubmissionOutboxMutationGate.unblockReviewSubmissions()
    }

    private func completePendingGuestUpgradeIfNeeded(
        state: PendingGuestUpgradeState
    ) async throws -> PendingGuestUpgradeCompletedState {
        switch state {
        case .completed(let completedState):
            return completedState
        case .inFlight(let inFlightState):
            let credentials = try await self.loadPendingGuestUpgradeCredentials(commonState: inFlightState.common)
            let guestSession = try self.loadPendingGuestUpgradeGuestSession(state: inFlightState)
            let workspace = try await self.dependencies.guestCloudAuthService.completeGuestUpgrade(
                apiBaseUrl: inFlightState.common.apiBaseUrl,
                bearerToken: credentials.idToken,
                guestToken: guestSession.guestToken,
                selection: cloudGuestUpgradeSelection(selection: inFlightState.selection),
                supportsDroppedEntities: inFlightState.supportsDroppedEntities,
                guestWorkspaceSyncedAndOutboxDrained: true
            )
            let completionState = pendingGuestUpgradeCompletedState(
                state: inFlightState,
                workspace: workspace
            )
            try self.savePendingGuestUpgradeState(state: .completed(completionState))
            return completionState
        }
    }

    private func loadPendingGuestUpgradeCredentials(
        commonState: PendingGuestUpgradeCommonState
    ) async throws -> StoredCloudCredentials {
        let configuration = try self.currentCloudServiceConfiguration()
        guard configuration.apiBaseUrl == commonState.apiBaseUrl && configuration.mode == commonState.configurationMode else {
            throw LocalStoreError.database(
                "Pending guest upgrade cloud configuration mismatch: pendingApiBaseUrl=\(commonState.apiBaseUrl) currentApiBaseUrl=\(configuration.apiBaseUrl) pendingMode=\(commonState.configurationMode.rawValue) currentMode=\(configuration.mode.rawValue)"
            )
        }

        return try await self.refreshCloudCredentials(forceRefresh: false)
    }

    private func loadPendingGuestUpgradeGuestSession(
        state: PendingGuestUpgradeInFlightState
    ) throws -> StoredGuestCloudSession {
        // Only in-flight replay needs the guest token. Completed checkpoints
        // already have the linked workspace and must not require guest storage.
        guard let guestSession = try self.dependencies.guestCredentialStore.loadGuestSession() else {
            throw LocalStoreError.database(
                "In-flight pending guest upgrade cannot replay backend completion because the guest credential is missing from secure storage. Restore the guest session on this device or contact support before resetting local data."
            )
        }
        guard guestSession.apiBaseUrl == state.common.apiBaseUrl
            && guestSession.configurationMode == state.common.configurationMode else {
            throw LocalStoreError.database(
                "In-flight pending guest upgrade credential mismatch: pendingApiBaseUrl=\(state.common.apiBaseUrl) credentialApiBaseUrl=\(guestSession.apiBaseUrl) pendingMode=\(state.common.configurationMode.rawValue) credentialMode=\(guestSession.configurationMode.rawValue)"
            )
        }
        guard guestSession.userId == state.guestIdentity.userId
            && guestSession.workspaceId == state.guestIdentity.workspaceId else {
            throw LocalStoreError.database(
                "In-flight pending guest upgrade guest identity mismatch: pendingGuestUserId=\(state.guestIdentity.userId) credentialGuestUserId=\(guestSession.userId) pendingGuestWorkspaceId=\(state.guestIdentity.workspaceId) credentialGuestWorkspaceId=\(guestSession.workspaceId). Restore the original guest session for this pending upgrade before retrying recovery."
            )
        }

        return guestSession
    }

    private func savePendingGuestUpgradeState(state: PendingGuestUpgradeState) throws {
        let data = try self.encoder.encode(state)
        self.userDefaults.set(data, forKey: pendingGuestUpgradeUserDefaultsKey)
    }

    private func loadPendingGuestUpgradeState() throws -> PendingGuestUpgradeState? {
        guard let data = self.userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey) else {
            return nil
        }

        let state = try self.decoder.decode(PendingGuestUpgradeState.self, from: data)
        return state
    }

    func finishCloudLink(linkedSession: CloudLinkedSession, trigger: CloudSyncTrigger) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performCloudLink(linkedSession: linkedSession, trigger: trigger)
        }
    }

    private func performCloudLink(linkedSession: CloudLinkedSession, trigger: CloudSyncTrigger) async throws {
        if self.cloudSettings?.cloudState == .linked
            && self.cloudSettings?.linkedUserId == linkedSession.userId {
            let database = try requireLocalDatabase(database: self.database)
            if self.workspace?.workspaceId == linkedSession.workspaceId {
                try database.updateCloudSettings(
                    cloudState: .linked,
                    linkedUserId: linkedSession.userId,
                    linkedWorkspaceId: linkedSession.workspaceId,
                    activeWorkspaceId: linkedSession.workspaceId,
                    linkedEmail: linkedSession.email
                )
                try self.reload()
                try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
            } else {
                try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
            }
            return
        }

        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.syncStatus = .syncing
        var didCompleteLocalLink = false
        do {
            let remoteWorkspaceIsEmpty = try await self.isLinkedWorkspaceEmptyForBootstrap(
                linkedSession: linkedSession
            )
            let migrationKind = remoteWorkspaceIsEmpty ? "preserve_local_data" : "replace_local_shell"
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            try context.database.migrateLocalWorkspaceToLinkedWorkspace(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            if linkedSession.authorization.isGuest {
                try self.applyGuestCloudStateBeforeReload(
                    database: context.database,
                    session: linkedSession
                )
            }

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            try self.reload()
            didCompleteLocalLink = true
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId
            )
            try self.reload()
        } catch {
            if didCompleteLocalLink == false {
                logCloudFlowPhase(
                    phase: .linkLocalWorkspace,
                    outcome: "failure",
                    workspaceId: linkedSession.workspaceId,
                    installationId: self.cloudSettings?.installationId,
                    sourceWorkspaceId: context.workspaceId,
                    targetWorkspaceId: linkedSession.workspaceId,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
            }
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    private func finishCompletedGuestCloudLink(
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary,
        trigger: CloudSyncTrigger
    ) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performCompletedGuestCloudLink(
                linkedSession: linkedSession,
                workspace: workspace,
                trigger: trigger
            )
        }
    }

    private func performCompletedGuestCloudLink(
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary,
        trigger: CloudSyncTrigger
    ) async throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.syncStatus = .syncing
        var didCompleteLocalLink = false
        let migrationKind = "guest_upgrade_hydrate_remote"
        do {
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: nil
            )
            // Backend completion already merged drained guest cloud state.
            // Do not migrate any local guest outbox; switch locally and hydrate
            // the linked workspace from remote instead.
            try context.database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession,
                workspace: workspace
            )

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            try self.reload()
            didCompleteLocalLink = true
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: nil
            )
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId
            )
            try self.reload()
        } catch {
            if didCompleteLocalLink == false {
                logCloudFlowPhase(
                    phase: .linkLocalWorkspace,
                    outcome: "failure",
                    workspaceId: linkedSession.workspaceId,
                    installationId: self.cloudSettings?.installationId,
                    sourceWorkspaceId: context.workspaceId,
                    targetWorkspaceId: linkedSession.workspaceId,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
            }
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    private func applyGuestCloudStateBeforeReload(
        database: LocalDatabase,
        session: CloudLinkedSession
    ) throws {
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: session.userId,
            linkedWorkspaceId: session.workspaceId,
            activeWorkspaceId: session.workspaceId,
            linkedEmail: nil
        )
    }

    /**
     Restores a cloud session for the already-linked local workspace without
     resetting review UI state. This keeps the locally rendered card visible
     unless the sync result produces an actual review data change.
     */
    func performSameWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        self.syncStatus = .syncing

        do {
            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } catch {
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    func performActiveWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        let database = try requireLocalDatabase(database: self.database)
        let cachedWorkspace = try database.loadCachedWorkspaces().first { workspace in
            workspace.workspaceId == linkedSession.workspaceId
        }
        let workspaceSummary = CloudWorkspaceSummary(
            workspaceId: linkedSession.workspaceId,
            name: cachedWorkspace?.name ?? "Personal",
            createdAt: cachedWorkspace?.createdAt ?? nowIsoTimestamp(),
            isSelected: true
        )

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: linkedSession.workspaceId)
        try database.switchActiveWorkspace(workspace: workspaceSummary, linkedSession: linkedSession)
        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        try self.reload()
        try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
    }

    private func prepareGuestUpgradeModeIfNeeded(
        verifiedContext: CloudVerifiedAuthContext
    ) async throws -> CloudGuestUpgradeMode? {
        guard self.cloudSettings?.cloudState == .guest else {
            return nil
        }
        guard let guestSession = try self.loadGuestSessionForCurrentConfiguration() else {
            return nil
        }

        return try await self.dependencies.guestCloudAuthService.prepareGuestUpgrade(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            bearerToken: verifiedContext.credentials.idToken,
            guestToken: guestSession.guestToken
        )
    }

    private func switchCloudServer(override: CloudServerOverride?) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
        self.clearPendingGuestUpgradeStateAndUnblockMutations()
        try context.database.clearCloudSyncState(workspaceId: context.workspaceId)
        try context.database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            activeWorkspaceId: context.workspaceId,
            linkedEmail: nil
        )

        if let override {
            try saveCloudServerOverride(
                override: override,
                userDefaults: self.userDefaults,
                encoder: self.encoder
            )
        } else {
            clearCloudServerOverride(userDefaults: self.userDefaults)
        }

        if override == nil {
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } else {
            self.userDefaults.set(true, forKey: pendingCloudServerBootstrapUserDefaultsKey)
        }
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    private func shouldValidateEmptyRemoteWorkspaceBeforeBootstrap() async throws -> Bool {
        let configuration = try self.currentCloudServiceConfiguration()
        return configuration.mode == .custom
            && self.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey)
    }

    private func isLinkedWorkspaceEmptyForBootstrap(linkedSession: CloudLinkedSession) async throws -> Bool {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
        return try await cloudSyncService.isWorkspaceEmptyForBootstrap(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            workspaceId: linkedSession.workspaceId,
            installationId: cloudSettings.installationId
        )
    }
}
