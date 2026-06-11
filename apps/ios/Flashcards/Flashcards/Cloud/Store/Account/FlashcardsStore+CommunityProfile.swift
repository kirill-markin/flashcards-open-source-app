import Foundation

/// Community public profile lifecycle for the leaderboard participation setting.
/// Participation only affects linked accounts: guests never appear on the
/// leaderboard, so the toggle is exposed for linked accounts only.
@MainActor
extension FlashcardsStore {
    var canManageLeaderboardParticipation: Bool {
        self.cloudSettings?.cloudState == .linked
    }

    func refreshCommunityPublicProfileIfAvailable() async throws {
        guard self.canManageLeaderboardParticipation else {
            self.communityPublicProfile = nil
            return
        }
        guard self.isCommunityProfileUpdateInFlight == false else {
            return
        }
        guard let session = try await self.cloudSessionForAccountContextRefresh() else {
            return
        }
        let refreshGeneration = self.communityProfileRefreshGeneration

        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let profile = try await cloudSyncService.loadCommunityPublicProfile(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue
        )

        guard refreshGeneration == self.communityProfileRefreshGeneration,
              self.isCommunityProfileUpdateInFlight == false,
              self.cloudSettings?.linkedUserId == session.userId else {
            return
        }

        self.communityPublicProfile = profile
    }

    func updateLeaderboardParticipationEnabled(isEnabled: Bool) async throws {
        guard self.canManageLeaderboardParticipation else {
            throw LocalStoreError.uninitialized("Leaderboard participation requires a linked account")
        }

        // Apply the optimistic value before any await so the toggle reflects the
        // tap immediately, and invalidate any in-flight profile read so a slow
        // GET response cannot land later and overwrite the value chosen here.
        self.communityProfileRefreshGeneration += 1
        let updateGeneration = self.communityProfileRefreshGeneration
        let previousProfile = self.communityPublicProfile
        if let previousProfile {
            self.communityPublicProfile = CommunityPublicProfile(
                publicProfileId: previousProfile.publicProfileId,
                anonymousDisplayName: previousProfile.anonymousDisplayName,
                leaderboardParticipationEnabled: isEnabled,
                linkedAccountRequiredForLeaderboard: previousProfile.linkedAccountRequiredForLeaderboard
            )
        }
        self.isCommunityProfileUpdateInFlight = true

        do {
            guard let session = try await self.cloudSessionForAccountContextRefresh() else {
                throw LocalStoreError.uninitialized("Cloud account is unavailable")
            }
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let updatedProfile = try await cloudSyncService.updateCommunityLeaderboardParticipation(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorizationHeaderValue,
                isEnabled: isEnabled
            )
            self.isCommunityProfileUpdateInFlight = false
            guard self.cloudSettings?.linkedUserId == session.userId else {
                return
            }

            self.communityPublicProfile = updatedProfile
            self.handleProgressLeaderboardParticipationDidChange()
        } catch {
            self.isCommunityProfileUpdateInFlight = false
            // Roll back only when no newer write or identity reset superseded
            // this update; both bump the generation.
            if self.communityProfileRefreshGeneration == updateGeneration {
                self.communityPublicProfile = previousProfile
            }
            throw error
        }
    }

    /// The cached leaderboard payload still carries the previous participation
    /// status, and the in-memory invalidation alone would not survive an app
    /// restart, so drop the cached payload entirely and force a refetch.
    private func handleProgressLeaderboardParticipationDidChange() {
        guard let cloudSettings = self.cloudSettings else {
            return
        }

        let scopeKey = ProgressLeaderboardScopeKey(
            cloudState: cloudSettings.cloudState,
            linkedUserId: cloudSettings.linkedUserId,
            localeIdentifier: progressLeaderboardPreferredLocaleIdentifier()
        )
        self.removePersistedProgressLeaderboardServerBase(scopeKey: scopeKey)
        if self.progressLeaderboardServerBaseCache?.scopeKey == scopeKey {
            self.progressLeaderboardServerBaseCache = nil
        }
        self.invalidateProgressLeaderboard(scopeKey: scopeKey)
        // Republish immediately so rows fetched under the previous participation
        // status are never rendered again while the forced refetch is pending.
        self.publishProgressLeaderboardSnapshotIsolatingErrors(scopeKey: scopeKey, now: Date())
    }
}
