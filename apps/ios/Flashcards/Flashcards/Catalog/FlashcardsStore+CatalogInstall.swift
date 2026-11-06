import Foundation

@MainActor
extension FlashcardsStore {
    /// Installs a public deck version into the current workspace with the default options, unless
    /// that workspace already holds the package, then syncs so its cards are local before Review.
    /// A person without a cloud session gets a guest one, the same way AI chat does.
    func installCatalogDeckIntoCurrentWorkspace(packageVersionId: String) async throws {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let session = try await self.cloudSessionForCatalogInstall(trigger: trigger)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        guard workspaceId == session.workspaceId else {
            throw LocalStoreError.validation(
                "Catalog install requires the current workspace to match the active cloud session. workspaceId=\(workspaceId) sessionWorkspaceId=\(session.workspaceId)"
            )
        }
        guard let installationId = self.cloudSettings?.installationId else {
            throw LocalStoreError.uninitialized("Catalog install requires cloud settings with an installation id")
        }
        let replicaId = try workspacePackageImportReplicaId(workspaceId: workspaceId, installationId: installationId)

        do {
            try await self.withCloudSessionPreservingStableContext(linkedSession: session) { refreshedSession in
                let installContext = try await cloudSyncService.loadCatalogPackageInstallContext(
                    apiBaseUrl: refreshedSession.apiBaseUrl,
                    authorizationHeader: refreshedSession.authorizationHeaderValue,
                    packageVersionId: packageVersionId
                )
                guard let workspaceContext = installContext.workspaces.first(where: { $0.workspaceId == workspaceId }) else {
                    throw LocalStoreError.validation(
                        "Catalog install context does not list the current workspace. workspaceId=\(workspaceId) packageVersionId=\(packageVersionId)"
                    )
                }
                if workspaceContext.previousInstall != nil {
                    return
                }

                let installId = UUID().uuidString.lowercased()
                let installedAt = formatIsoTimestamp(date: Date())
                let response = try await cloudSyncService.installCatalogPackageVersion(
                    apiBaseUrl: refreshedSession.apiBaseUrl,
                    authorizationHeader: refreshedSession.authorizationHeaderValue,
                    workspaceId: workspaceId,
                    packageVersionId: packageVersionId,
                    request: CatalogPackageInstallRequest(
                        installId: installId,
                        installedAt: installedAt,
                        clientUpdatedAt: installedAt,
                        lastModifiedByReplicaId: replicaId,
                        operationIdPrefix: installId,
                        addImportTag: false,
                        removeTags: []
                    )
                )
                guard response.summary.installId == installId else {
                    throw LocalStoreError.validation(
                        "Catalog install returned install \(response.summary.installId), but the request sent \(installId). packageVersionId=\(packageVersionId)"
                    )
                }
            }

            self.syncStatus = .syncing
            // A sync already running may have pulled before the install, so this waits for a new one.
            let syncResult = try await self.withCloudSessionPreservingStableContext(linkedSession: session) { refreshedSession in
                try await self.runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: refreshedSession)
            }
            try await self.applySyncResultWithoutBlockingReset(syncResult: syncResult, now: Date(), trigger: trigger)
        } catch {
            if isRequestCancellationError(error: error) {
                if self.syncStatus == .syncing {
                    self.syncStatus = .idle
                }
                throw error
            }
            if self.syncStatus == .syncing {
                self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error, trigger: trigger)
            }
            if isCatalogDeckUnavailableError(error: error) {
                throw error
            }
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: session,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "catalog_deck_install"
            )
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    private func cloudSessionForCatalogInstall(trigger: CloudSyncTrigger) async throws -> CloudLinkedSession {
        try self.throwIfCloudCredentialRecoveryRequired()
        try self.throwIfCustomGuestWorkspacePaused()
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        if self.cloudSettings?.cloudState == .linked {
            return try await self.prepareAuthenticatedCloudSessionForAI()
        }

        return try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger).session
    }
}
