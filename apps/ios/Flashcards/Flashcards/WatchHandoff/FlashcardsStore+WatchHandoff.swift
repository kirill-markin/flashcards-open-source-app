#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation

/// Why the iPhone answered the watch the way it did; logged with every handled request.
enum WatchHandoffReplyReason: String, Sendable {
    case signedIn = "signed_in"
    case signedOut = "signed_out"
    case guest
    /// The contract carries no server configuration, so a custom server's tokens never reach the watch,
    /// which talks to the official API only.
    case customServer = "custom_server"
    case credentialRecoveryRequired = "credential_recovery_required"
}

struct WatchHandoffReplyResult: Sendable {
    let reply: WatchHandoffReply
    let reason: WatchHandoffReplyReason
    let workspaceId: String?
}

enum WatchHandoffReplyBuildError: LocalizedError {
    case linkedUserUnavailable
    case linkedWorkspaceUnavailable
    case accountChangedDuringCredentialRefresh

    var errorDescription: String? {
        switch self {
        case .linkedUserUnavailable:
            return "Watch handoff reply cannot be built: the linked cloud account has no user id"
        case .linkedWorkspaceUnavailable:
            return "Watch handoff reply cannot be built: the linked cloud account has no active workspace"
        case .accountChangedDuringCredentialRefresh:
            return "Watch handoff reply cannot be built: the linked account or workspace changed while its credentials were refreshing"
        }
    }
}

private struct WatchHandoffLinkedAccount: Equatable {
    let linkedUserId: String
    let email: String?
    let workspaceId: String
}

private enum WatchHandoffAccountState: Equatable {
    case linked(WatchHandoffLinkedAccount)
    case signedOut(WatchHandoffReplyReason)
}

private func makeWatchHandoffAccountState(
    cloudSettings: CloudSettings?,
    configurationMode: CloudServiceConfigurationMode,
    cloudCredentialRecoveryState: CloudCredentialRecoveryState?
) throws -> WatchHandoffAccountState {
    if configurationMode == .custom {
        return .signedOut(.customServer)
    }
    guard let cloudSettings else {
        return .signedOut(.signedOut)
    }

    switch cloudSettings.cloudState {
    case .guest:
        return .signedOut(.guest)
    case .disconnected, .linkingReady:
        return .signedOut(.signedOut)
    case .linked:
        break
    }

    if cloudCredentialRecoveryState != nil {
        return .signedOut(.credentialRecoveryRequired)
    }
    guard let linkedUserId = cloudSettings.linkedUserId, linkedUserId.isEmpty == false else {
        throw WatchHandoffReplyBuildError.linkedUserUnavailable
    }
    guard let workspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId, workspaceId.isEmpty == false else {
        throw WatchHandoffReplyBuildError.linkedWorkspaceUnavailable
    }

    return .linked(
        WatchHandoffLinkedAccount(
            linkedUserId: linkedUserId,
            email: cloudSettings.linkedEmail,
            workspaceId: workspaceId
        )
    )
}

@MainActor
extension FlashcardsStore {
    /// Builds the watch's reply from stored state only: it may run while the app is woken in the background,
    /// so it starts no sync and touches no UI state.
    func makeWatchHandoffReply() async throws -> WatchHandoffReplyResult {
        let accountState = try self.currentWatchHandoffAccountState()
        let account: WatchHandoffLinkedAccount
        switch accountState {
        case .signedOut(let reason):
            return WatchHandoffReplyResult(reply: .signedOut, reason: reason, workspaceId: nil)
        case .linked(let linkedAccount):
            account = linkedAccount
        }

        let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
        // The refresh suspends, and a sign-out or workspace switch can land in it.
        guard try self.currentWatchHandoffAccountState() == accountState else {
            throw WatchHandoffReplyBuildError.accountChangedDuringCredentialRefresh
        }

        let reviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: account.workspaceId
        )
        return WatchHandoffReplyResult(
            reply: .signedIn(
                WatchHandoffSignedInAccount(
                    credentials: credentials,
                    linkedUserId: account.linkedUserId,
                    email: account.email,
                    workspaceId: account.workspaceId,
                    reviewFilter: makePersistedReviewFilter(reviewFilter: reviewFilter)
                )
            ),
            reason: .signedIn,
            workspaceId: account.workspaceId
        )
    }

    private func currentWatchHandoffAccountState() throws -> WatchHandoffAccountState {
        try makeWatchHandoffAccountState(
            cloudSettings: self.cloudSettings,
            configurationMode: try self.currentCloudServiceConfiguration().mode,
            cloudCredentialRecoveryState: self.cloudCredentialRecoveryState
        )
    }
}
#endif
