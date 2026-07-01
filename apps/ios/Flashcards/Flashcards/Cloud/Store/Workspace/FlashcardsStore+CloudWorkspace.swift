import Foundation

private struct WorkspacePackageCloudContext {
    let session: CloudLinkedSession
    let workspaceId: String
}

@MainActor
extension FlashcardsStore {
    func workspaceOperationGuidanceMessage(error: Error) -> String? {
        if isRequestCancellationError(error: error) {
            return nil
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
        }
        return self.blockedCloudIdentityConflictMessage(error: error)
    }

    func shouldPresentWorkspaceOperationTechnicalError(error: Error) -> Bool {
        if isRequestCancellationError(error: error) {
            return false
        }

        if self.workspaceOperationGuidanceMessage(error: error) != nil {
            return false
        }

        return true
    }

    private func captureWorkspaceCloudSyncFailureIfNeeded(error: Error, trigger: CloudSyncTrigger, action: String) -> Bool {
        guard let linkedSession = self.cloudRuntime.activeCloudSession() else {
            return false
        }
        return self.captureCloudSyncFailureIfNeeded(
            error: error,
            linkedSession: linkedSession,
            fallbackCloudState: self.cloudSettings?.cloudState,
            trigger: trigger,
            action: action
        )
    }

    func listAgentApiKeys() async throws -> (connections: [AgentApiKeyConnection], instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.listAgentApiKeys(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
        }
    }

    func revokeAgentApiKey(connectionId: String) async throws -> (connection: AgentApiKeyConnection, instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.revokeAgentApiKey(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                connectionId: connectionId
            )
        }
    }

    func listLinkedWorkspaces() async throws -> [CloudWorkspaceSummary] {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace switching is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let account = try await cloudSyncService.fetchCloudAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
            self.applyCloudAccountPreferences(account: account)
            return account.workspaces
        }
    }

    func switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace switching is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let currentWorkspaceId = self.workspace?.workspaceId
        let selectedWorkspace = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            switch selection {
            case .existing(let workspaceId):
                return try await cloudSyncService.selectWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: workspaceId
                )
            case .createNew:
                return try await cloudSyncService.createWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    name: "Personal"
                )
            }
        }

        if currentWorkspaceId == selectedWorkspace.workspaceId {
            return
        }

        let activeSession = try await self.withAuthenticatedCloudSession { session in
            CloudLinkedSession(
                userId: session.userId,
                workspaceId: selectedWorkspace.workspaceId,
                email: session.email,
                configurationMode: session.configurationMode,
                apiBaseUrl: session.apiBaseUrl,
                authorization: session.authorization
            )
        }

        self.cloudRuntime.cancelForWorkspaceSwitch()
        await self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: selectedWorkspace.workspaceId)
        let database = try requireLocalDatabase(database: self.database)
        try database.switchActiveWorkspace(
            workspace: selectedWorkspace,
            linkedSession: activeSession
        )
        self.cloudRuntime.setActiveCloudSession(linkedSession: activeSession)
        try self.reload()
        self.syncStatus = .syncing

        do {
            let syncResult = try await self.runLinkedSync(linkedSession: activeSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
        } catch {
            let didCapture = self.captureWorkspaceCloudSyncFailureIfNeeded(
                error: error,
                trigger: trigger,
                action: "switch_workspace_sync"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func renameCurrentWorkspace(name: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace rename is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            throw LocalStoreError.validation("Workspace name is required")
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let renamedWorkspace = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.renameWorkspace(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                workspaceId: workspaceId,
                name: trimmedName
            )
        }

        let database = try requireLocalDatabase(database: self.database)
        _ = try database.updateWorkspaceName(workspaceId: workspaceId, name: renamedWorkspace.name)
        try self.reload()
        self.globalErrorMessage = ""
    }

    func loadCurrentWorkspaceDeletePreview() async throws -> CloudWorkspaceDeletePreview {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace deletion is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.loadWorkspaceDeletePreview(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                workspaceId: workspaceId
            )
        }
    }

    func loadCurrentWorkspaceResetProgressPreview() async throws -> CloudWorkspaceResetProgressPreview {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace progress reset is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let preview: CloudWorkspaceResetProgressPreview
        do {
            preview = try await self.withAuthenticatedCloudSession { session in
                let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
                let syncResult = try await self.runLinkedSync(linkedSession: session)
                let now = Date()
                try await self.applySyncResultWithoutBlockingReset(
                    syncResult: syncResult,
                    now: now,
                    trigger: trigger
                )
                return try await cloudSyncService.loadWorkspaceResetProgressPreview(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: workspaceId
                )
            }
        } catch {
            let didCapture = self.captureWorkspaceCloudSyncFailureIfNeeded(
                error: error,
                trigger: trigger,
                action: "load_workspace_reset_progress_preview"
            )
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }

        guard preview.confirmationText == workspaceResetProgressConfirmationText else {
            throw LocalStoreError.validation("Workspace progress reset confirmation phrase did not match the expected value")
        }

        return preview
    }

    func previewCurrentWorkspacePackageExport(
        request: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportPreviewResponse {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        var exportContext = try await self.prepareWorkspacePackageExportCloudContext(trigger: trigger)
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        self.syncStatus = .syncing

        do {
            let syncResult = try await self.runLinkedSyncPreservingSessionContext(linkedSession: exportContext.session)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            exportContext = try await self.prepareWorkspacePackageExportCloudContext(trigger: trigger)
            let preview = try await cloudSyncService.previewWorkspacePackageExport(
                apiBaseUrl: exportContext.session.apiBaseUrl,
                authorizationHeader: exportContext.session.authorizationHeaderValue,
                workspaceId: exportContext.workspaceId,
                request: request
            )
            self.globalErrorMessage = ""
            return preview
        } catch {
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: exportContext.session,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "workspace_package_export_preview"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error, trigger: trigger)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func exportCurrentWorkspacePackage(
        request: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportDownloadResponse {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        let exportContext = try await self.prepareWorkspacePackageExportCloudContext(trigger: trigger)
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)

        do {
            let response = try await cloudSyncService.exportWorkspacePackage(
                apiBaseUrl: exportContext.session.apiBaseUrl,
                authorizationHeader: exportContext.session.authorizationHeaderValue,
                workspaceId: exportContext.workspaceId,
                request: request
            )
            self.globalErrorMessage = ""
            return response
        } catch {
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: exportContext.session,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "workspace_package_export"
            )
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func previewCurrentWorkspacePackageImport(packageBytes: Data) async throws -> WorkspacePackageImportPreviewResponse {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        let importContext = try await self.prepareWorkspacePackageImportCloudContext(trigger: trigger)
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        return try await cloudSyncService.previewWorkspacePackageImport(
            apiBaseUrl: importContext.session.apiBaseUrl,
            authorizationHeader: importContext.session.authorizationHeaderValue,
            workspaceId: importContext.workspaceId,
            packageBytes: packageBytes
        )
    }

    func confirmCurrentWorkspacePackageImport(
        packageBytes: Data,
        options: WorkspacePackageImportConfirmOptions
    ) async throws -> WorkspacePackageImportConfirmResponse {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        var importContext = try await self.prepareWorkspacePackageImportCloudContext(trigger: trigger)
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        self.syncStatus = .syncing

        do {
            let preConfirmSyncResult = try await self.runLinkedSyncPreservingSessionContext(
                linkedSession: importContext.session
            )
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: preConfirmSyncResult,
                now: Date(),
                trigger: trigger
            )
            importContext = try await self.prepareWorkspacePackageImportCloudContext(trigger: trigger)
            self.syncStatus = .syncing

            let response = try await cloudSyncService.confirmWorkspacePackageImport(
                apiBaseUrl: importContext.session.apiBaseUrl,
                authorizationHeader: importContext.session.authorizationHeaderValue,
                workspaceId: importContext.workspaceId,
                packageBytes: packageBytes,
                options: options
            )
            let postConfirmSyncResult = try await self.runLinkedSyncPreservingSessionContext(
                linkedSession: importContext.session
            )
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: postConfirmSyncResult,
                now: Date(),
                trigger: trigger
            )
            return response
        } catch {
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: importContext.session,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "workspace_package_import"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error, trigger: trigger)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func deleteCurrentWorkspace(confirmationText: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace deletion is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let localWorkspaceId = try requireWorkspaceId(workspace: self.workspace)
        self.syncStatus = .syncing

        do {
            let deleteResult = try await self.withAuthenticatedCloudSession { session in
                let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
                let response = try await cloudSyncService.deleteWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: localWorkspaceId,
                    confirmationText: confirmationText
                )
                return (session, response)
            }

            let replacementSession = CloudLinkedSession(
                userId: deleteResult.0.userId,
                workspaceId: deleteResult.1.workspace.workspaceId,
                email: deleteResult.0.email,
                configurationMode: deleteResult.0.configurationMode,
                apiBaseUrl: deleteResult.0.apiBaseUrl,
                authorization: deleteResult.0.authorization
            )
            let database = try requireLocalDatabase(database: self.database)
            self.cloudRuntime.cancelForWorkspaceSwitch()
            await self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: replacementSession.workspaceId)
            try database.replaceLocalWorkspaceAfterRemoteDelete(
                localWorkspaceId: localWorkspaceId,
                replacementWorkspace: deleteResult.1.workspace,
                linkedSession: replacementSession
            )
            self.cloudRuntime.setActiveCloudSession(linkedSession: replacementSession)
            let syncResult = try await self.runLinkedSync(linkedSession: replacementSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
        } catch {
            let didCapture = self.captureWorkspaceCloudSyncFailureIfNeeded(
                error: error,
                trigger: trigger,
                action: "delete_workspace_sync"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func resetCurrentWorkspaceProgress(confirmationText: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace progress reset is available only for linked cloud workspaces")
        }

        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let localWorkspaceId = try requireWorkspaceId(workspace: self.workspace)
        self.syncStatus = .syncing

        do {
            let resetResult = try await self.withAuthenticatedCloudSession { session in
                let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
                let syncResult = try await self.runLinkedSync(linkedSession: session)
                let now = Date()
                try await self.applySyncResultWithoutBlockingReset(
                    syncResult: syncResult,
                    now: now,
                    trigger: trigger
                )
                let response = try await cloudSyncService.resetWorkspaceProgress(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: localWorkspaceId,
                    confirmationText: confirmationText
                )
                return (session, response)
            }

            let syncResult = try await self.runLinkedSync(linkedSession: resetResult.0)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.globalErrorMessage = ""

            if resetResult.1.ok == false {
                throw LocalStoreError.validation("Workspace progress reset did not return ok=true")
            }
        } catch {
            let didCapture = self.captureWorkspaceCloudSyncFailureIfNeeded(
                error: error,
                trigger: trigger,
                action: "reset_workspace_progress_sync"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    private func prepareWorkspacePackageImportCloudContext(
        trigger: CloudSyncTrigger
    ) async throws -> WorkspacePackageCloudContext {
        let session: CloudLinkedSession
        switch self.cloudSettings?.cloudState {
        case .linked:
            if self.cloudRuntime.activeCloudSession() == nil {
                try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
            }
            session = try await self.withAuthenticatedCloudSession { cloudSession in
                cloudSession
            }
        case .guest:
            let restoreResult = try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger)
            session = restoreResult.session
        case .disconnected, .linkingReady, nil:
            throw LocalStoreError.validation(
                aiSettingsLocalized(
                    "settings.workspace.import.cloudRequired",
                    "Media ZIP import requires a cloud account in this version."
                )
            )
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        guard workspaceId == session.workspaceId else {
            throw LocalStoreError.validation(
                "Workspace package import requires the current workspace to match the active cloud session."
            )
        }

        return WorkspacePackageCloudContext(session: session, workspaceId: workspaceId)
    }

    private func prepareWorkspacePackageExportCloudContext(
        trigger: CloudSyncTrigger
    ) async throws -> WorkspacePackageCloudContext {
        let session: CloudLinkedSession
        switch self.cloudSettings?.cloudState {
        case .linked:
            if self.cloudRuntime.activeCloudSession() == nil {
                try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
            }
            session = try await self.withAuthenticatedCloudSession { cloudSession in
                cloudSession
            }
        case .guest:
            let restoreResult = try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger)
            session = restoreResult.session
        case .disconnected, .linkingReady, nil:
            throw LocalStoreError.validation(
                aiSettingsLocalized(
                    "settings.workspace.export.cloudRequired",
                    "Media package export requires a cloud account in this version."
                )
            )
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        guard workspaceId == session.workspaceId else {
            throw LocalStoreError.validation(
                "Workspace package export requires the current workspace to match the active cloud session."
            )
        }

        return WorkspacePackageCloudContext(session: session, workspaceId: workspaceId)
    }
}
