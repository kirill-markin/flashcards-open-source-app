import Foundation

@MainActor
extension FlashcardsStore {
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

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
        }

        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let account = try await cloudSyncService.fetchCloudAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
            return account.workspaces
        }
    }

    func switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace switching is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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
        self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: selectedWorkspace.workspaceId)
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
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
        } catch {
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    func renameCurrentWorkspace(name: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace rename is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let preview = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let syncResult = try await self.runLinkedSync(linkedSession: session)
            let now = Date()
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: now,
                trigger: self.manualCloudSyncTrigger(now: now)
            )
            return try await cloudSyncService.loadWorkspaceResetProgressPreview(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                workspaceId: workspaceId
            )
        }

        guard preview.confirmationText == workspaceResetProgressConfirmationText else {
            throw LocalStoreError.validation("Workspace progress reset confirmation phrase did not match the expected value")
        }

        return preview
    }

    func deleteCurrentWorkspace(confirmationText: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace deletion is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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
            self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: replacementSession.workspaceId)
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
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
        } catch {
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    func resetCurrentWorkspaceProgress(confirmationText: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace progress reset is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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
                    trigger: self.manualCloudSyncTrigger(now: now)
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
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
            self.globalErrorMessage = ""

            if resetResult.1.ok == false {
                throw LocalStoreError.validation("Workspace progress reset did not return ok=true")
            }
        } catch {
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }
}
