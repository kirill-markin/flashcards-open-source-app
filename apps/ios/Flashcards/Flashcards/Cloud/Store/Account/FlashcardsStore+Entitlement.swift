import Foundation

private let cloudEntitlementCacheUserDefaultsKey: String = "cloud-entitlement-cache-v1"

/// The last entitlement a sync pull reported, bound to the user it was reported for so a relaunch
/// under another identity never shows it.
private struct PersistedCloudEntitlement: Codable, Hashable {
    let userId: String
    let entitlement: CloudEntitlement
}

@MainActor
extension FlashcardsStore {
    /**
     * Stores the entitlement a completed sync pulled. A sync that pulled none leaves the last value
     * in place: an absent entitlement means unknown, never free, and downgrades nobody
     * (docs/premium-entitlements.md, "What a client receives").
     */
    func applyPulledCloudEntitlement(syncResult: CloudSyncResult, linkedSession: CloudLinkedSession) {
        guard let entitlement = syncResult.entitlement else {
            return
        }
        // The identity can move while a sync is in flight; the value belongs to the one it was pulled for.
        guard self.currentCloudEntitlementUserId() == linkedSession.userId else {
            return
        }

        self.cloudEntitlement = entitlement
        self.savePersistedCloudEntitlement(
            PersistedCloudEntitlement(userId: linkedSession.userId, entitlement: entitlement)
        )
    }

    func reloadCachedCloudEntitlementForCurrentIdentity() {
        guard let userId = self.currentCloudEntitlementUserId(),
            let persisted = self.loadPersistedCloudEntitlement(),
            persisted.userId == userId else {
            self.cloudEntitlement = nil
            return
        }

        self.cloudEntitlement = persisted.entitlement
    }

    func resetCloudEntitlementForCloudIdentityReset() {
        self.cloudEntitlement = nil
        self.userDefaults.removeObject(forKey: cloudEntitlementCacheUserDefaultsKey)
    }

    private func currentCloudEntitlementUserId() -> String? {
        guard let cloudSettings = self.cloudSettings else {
            return nil
        }
        guard cloudSettings.cloudState == .guest || cloudSettings.cloudState == .linked else {
            return nil
        }
        guard let userId = cloudSettings.linkedUserId, userId.isEmpty == false else {
            return nil
        }

        return userId
    }

    private func loadPersistedCloudEntitlement() -> PersistedCloudEntitlement? {
        guard let data = self.userDefaults.data(forKey: cloudEntitlementCacheUserDefaultsKey) else {
            return nil
        }

        do {
            return try self.decoder.decode(PersistedCloudEntitlement.self, from: data)
        } catch {
            self.captureCloudEntitlementCacheFailure(error: error, stage: "decode")
            self.userDefaults.removeObject(forKey: cloudEntitlementCacheUserDefaultsKey)
            return nil
        }
    }

    private func savePersistedCloudEntitlement(_ persisted: PersistedCloudEntitlement) {
        do {
            let data = try self.encoder.encode(persisted)
            self.userDefaults.set(data, forKey: cloudEntitlementCacheUserDefaultsKey)
        } catch {
            self.captureCloudEntitlementCacheFailure(error: error, stage: "encode")
            self.userDefaults.removeObject(forKey: cloudEntitlementCacheUserDefaultsKey)
        }
    }

    private func captureCloudEntitlementCacheFailure(error: Error, stage: String) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .subscription,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: "cloud_entitlement_cache",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}
