@MainActor
extension FlashcardsStore {
    func loadLocalSyncDiagnosticsSnapshot() async throws -> LocalSyncDiagnosticsSnapshot {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadLocalSyncDiagnosticsSnapshot(
            workspaceId: workspaceId,
            latestCardSyncSuccess: self.lastSuccessfulCloudSyncAt,
            latestSyncError: localSyncDiagnosticsLatestSyncError(status: self.syncStatus)
        )
    }
}

private func localSyncDiagnosticsLatestSyncError(status: SyncStatus) -> String? {
    switch status {
    case .blocked(let message), .failed(let message):
        return message
    case .idle, .syncing:
        return nil
    }
}
