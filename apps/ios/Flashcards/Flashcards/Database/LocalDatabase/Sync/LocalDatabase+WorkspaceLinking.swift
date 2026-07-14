import Foundation

struct PublicSyncConflictReIdRecovery: Hashable {
    let entityType: SyncEntityType
    let sourceEntityId: String
    let replacementEntityId: String
}

extension LocalDatabase {
    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        activeWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        try self.workspaceSettingsStore.updateCloudSettings(
            cloudState: cloudState,
            linkedUserId: linkedUserId,
            linkedWorkspaceId: linkedWorkspaceId,
            activeWorkspaceId: activeWorkspaceId,
            linkedEmail: linkedEmail
        )
    }

    func updateWorkspaceName(workspaceId: String, name: String) throws -> Workspace {
        try self.workspaceSettingsStore.updateWorkspaceName(workspaceId: workspaceId, name: name)
    }

    func switchActiveWorkspace(
        workspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        let shellStore = self.makeWorkspaceShellStore()
        try self.core.inTransaction {
            try shellStore.ensureLinkedWorkspaceShell(workspace: workspace)
            try shellStore.ensureSyncStateExists(workspaceId: workspace.workspaceId)
            try shellStore.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: workspace.workspaceId,
                activeWorkspaceId: workspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    /**
     Migrates the current local workspace shell into a linked workspace target.

     `sync_state` belongs to the remote workspace identity, not to whichever
     local rows currently happen to exist on device. When the workspace id
     changes we therefore never carry hot/review cursors across. For an empty
     remote workspace we preserve local cards/decks/reviews and recreate fresh
     sync state. For a non-empty remote workspace we discard the old local shell
     and rehydrate from the server.
     */
    func migrateLocalWorkspaceToLinkedWorkspace(
        localWorkspaceId: String,
        linkedSession: CloudLinkedSession,
        remoteWorkspaceIsEmpty: Bool
    ) throws {
        if localWorkspaceId == linkedSession.workspaceId {
            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                activeWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
            return
        }

        let shellStore = self.makeWorkspaceShellStore()
        let workspaceForker = self.makeWorkspaceForker(shellStore: shellStore)
        try self.core.inTransaction {
            if remoteWorkspaceIsEmpty {
                try workspaceForker.preserveLocalDataForEmptyRemoteWorkspace(
                    sourceWorkspaceId: localWorkspaceId,
                    destinationWorkspaceId: linkedSession.workspaceId
                )
            } else {
                try workspaceForker.replaceLocalShellForNonEmptyRemoteWorkspace(
                    sourceWorkspaceId: localWorkspaceId,
                    destinationWorkspaceId: linkedSession.workspaceId
                )
            }

            try shellStore.deleteOtherWorkspaces(exceptWorkspaceId: linkedSession.workspaceId)
            try shellStore.assertSingleWorkspaceInvariant(expectedWorkspaceId: linkedSession.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                activeWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    /**
     Switches local storage after backend guest-upgrade completion.

     Backend completion only merges guest cloud state that was already synced,
     so this path never migrates pending guest outbox rows into the linked
     workspace. Remaining local hydration comes from ordinary linked sync.
     */
    func switchGuestUpgradeToLinkedWorkspaceFromRemote(
        localWorkspaceId: String,
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary
    ) throws {
        guard linkedSession.workspaceId == workspace.workspaceId else {
            throw LocalStoreError.database(
                "Guest upgrade linked session workspace does not match selected workspace: session=\(linkedSession.workspaceId) selected=\(workspace.workspaceId)"
            )
        }

        let shellStore = self.makeWorkspaceShellStore()
        try self.core.inTransaction {
            if localWorkspaceId == workspace.workspaceId {
                try shellStore.ensureLinkedWorkspaceShell(workspace: workspace)
                try shellStore.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
            } else {
                try shellStore.assertNoPendingOutboxEntriesBeforeGuestWorkspaceDelete(workspaceId: localWorkspaceId)
                try shellStore.deleteWorkspaceIfExists(workspaceId: workspace.workspaceId)
                try shellStore.ensureLinkedWorkspaceShell(workspace: workspace)
                try shellStore.resetSyncState(workspaceId: workspace.workspaceId)
                try shellStore.updateAccountWorkspaceReference(workspaceId: workspace.workspaceId)
                try shellStore.deleteWorkspaceIfExists(workspaceId: localWorkspaceId)
            }
            try shellStore.deleteOtherWorkspaces(exceptWorkspaceId: workspace.workspaceId)
            try shellStore.assertSingleWorkspaceInvariant(expectedWorkspaceId: workspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: workspace.workspaceId,
                activeWorkspaceId: workspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func repairLocalIdForPublicSyncConflict(
        workspaceId: String,
        syncConflict: CloudSyncConflictDetails
    ) throws -> PublicSyncConflictReIdRecovery {
        try PublicSyncConflictRepairer.validateRecoverable(syncConflict: syncConflict)

        let repairer = self.makePublicSyncConflictRepairer()
        return try self.core.inTransaction {
            try repairer.repairLocalIdForPublicSyncConflict(
                workspaceId: workspaceId,
                syncConflict: syncConflict
            )
        }
    }

    func replaceLocalWorkspaceAfterRemoteDelete(
        localWorkspaceId: String,
        replacementWorkspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        let shellStore = self.makeWorkspaceShellStore()
        try self.core.inTransaction {
            try shellStore.deleteWorkspaceIfExists(workspaceId: replacementWorkspace.workspaceId)
            try shellStore.ensureLinkedWorkspaceShell(workspace: replacementWorkspace)
            try shellStore.resetSyncState(workspaceId: replacementWorkspace.workspaceId)
            try shellStore.updateAccountWorkspaceReference(workspaceId: replacementWorkspace.workspaceId)
            try shellStore.deleteWorkspaceIfExists(workspaceId: localWorkspaceId)
            try shellStore.deleteOtherWorkspaces(exceptWorkspaceId: replacementWorkspace.workspaceId)
            try shellStore.assertSingleWorkspaceInvariant(expectedWorkspaceId: replacementWorkspace.workspaceId)
            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: replacementWorkspace.workspaceId,
                activeWorkspaceId: replacementWorkspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func resetForAccountDeletion() throws {
        try self.core.resetForAccountDeletion()
    }

    private func makeWorkspaceShellStore() -> WorkspaceShellStore {
        WorkspaceShellStore(
            core: self.core,
            workspaceSettingsStore: self.workspaceSettingsStore
        )
    }

    private func makeWorkspaceForker(shellStore: WorkspaceShellStore) -> WorkspaceForker {
        WorkspaceForker(
            core: self.core,
            workspaceSettingsStore: self.workspaceSettingsStore,
            shellStore: shellStore,
            outboxRewriter: self.makeWorkspaceOutboxRewriter()
        )
    }

    private func makePublicSyncConflictRepairer() -> PublicSyncConflictRepairer {
        PublicSyncConflictRepairer(
            core: self.core,
            outboxRewriter: self.makeWorkspaceOutboxRewriter()
        )
    }

    private func makeWorkspaceOutboxRewriter() -> WorkspaceOutboxRewriter {
        WorkspaceOutboxRewriter(core: self.core)
    }
}
