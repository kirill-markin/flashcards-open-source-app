import Foundation

/// Community public profile lifecycle for the leaderboard participation setting.
/// Participation controls anonymous leaderboard visibility for linked and guest
/// accounts. Guests can manage visibility, but still cannot view leaderboard rows.
@MainActor
extension FlashcardsStore {
    var canManageLeaderboardParticipation: Bool {
        switch self.cloudSettings?.cloudState {
        case .guest, .linked:
            return true
        case .disconnected, .linkingReady, nil:
            return false
        }
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

        let previousProfile = self.communityPublicProfile
        self.communityPublicProfile = profile
        if self.shouldResetProgressLeaderboardsAfterCommunityProfileRefresh(
            previousProfile: previousProfile,
            profile: profile
        ) {
            self.handleProgressLeaderboardParticipationDidChange()
        }
    }

    func updateLeaderboardParticipationEnabled(isEnabled: Bool) async throws {
        guard self.canManageLeaderboardParticipation else {
            throw LocalStoreError.uninitialized("Leaderboard participation requires a cloud account")
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
        let now = Date()
        self.removePersistedProgressLeaderboardServerBase(scopeKey: scopeKey)
        self.removePersistedProgressStreakLeaderboardServerBase(scopeKey: scopeKey)
        if self.progressLeaderboardServerBaseCache?.scopeKey == scopeKey {
            self.progressLeaderboardServerBaseCache = nil
        }
        if self.progressStreakLeaderboardServerBaseCache?.scopeKey == scopeKey {
            self.progressStreakLeaderboardServerBaseCache = nil
        }
        self.invalidateProgressLeaderboard(scopeKey: scopeKey)
        self.invalidateProgressStreakLeaderboard(scopeKey: scopeKey)
        // Republish immediately so rows fetched under the previous participation
        // status are never rendered again while the forced refetch is pending.
        self.publishProgressLeaderboardSnapshotIsolatingErrors(scopeKey: scopeKey, now: now)
        if let observedScopeKey = self.progressObservedScopeKey,
           self.currentProgressLeaderboardScopeKey(seriesScopeKey: observedScopeKey) == scopeKey {
            self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                scopeKey: scopeKey,
                seriesScopeKey: observedScopeKey,
                now: now
            )
        } else if self.progressStreakLeaderboardSnapshot?.scopeKey == scopeKey {
            self.applyProgressStreakLeaderboardSnapshot(snapshot: nil)
        }
    }

    private func shouldResetProgressLeaderboardsAfterCommunityProfileRefresh(
        previousProfile: CommunityPublicProfile?,
        profile: CommunityPublicProfile
    ) -> Bool {
        guard let previousProfile else {
            return profile.leaderboardParticipationEnabled == false
                || profile.linkedAccountRequiredForLeaderboard
                || self.progressLeaderboardServerBaseCache != nil
                || self.progressStreakLeaderboardServerBaseCache != nil
                || self.progressLeaderboardSnapshot != nil
                || self.progressStreakLeaderboardSnapshot != nil
        }

        return previousProfile.publicProfileId != profile.publicProfileId
            || previousProfile.anonymousDisplayName != profile.anonymousDisplayName
            || previousProfile.leaderboardParticipationEnabled != profile.leaderboardParticipationEnabled
            || previousProfile.linkedAccountRequiredForLeaderboard != profile.linkedAccountRequiredForLeaderboard
    }
}
