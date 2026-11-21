import Foundation
import SQLite3
import os

final class StorageFullEpisode: Sendable {
    private struct State: Sendable {
        var installation: StorageDiagnosticInstallation?
        var isPending = false
    }

    private let state = OSAllocatedUnfairLock(initialState: State())

    func updateInstallation(_ settings: CloudSettings?) {
        let installation = settings.map {
            StorageDiagnosticInstallation(id: $0.installationId, workspaceId: $0.activeWorkspaceId)
        }
        self.state.withLock { state in
            if state.installation?.id != installation?.id {
                state.isPending = false
            }
            state.installation = installation
        }
    }

    // Record queue failures before hopping to the main actor to collect optional diagnostics.
    @discardableResult
    func observe() -> StorageDiagnosticInstallation? {
        self.state.withLock { state in
            guard let installation = state.installation else {
                return nil
            }
            state.isPending = true
            return installation
        }
    }

    func logRecoveryIfNeeded(installationId: String, workspaceId: String, databaseURL: URL) {
        let shouldLog = self.state.withLock { state in
            guard state.installation?.id == installationId, state.isPending else {
                return false
            }
            state.isPending = false
            return true
        }
        guard shouldLog else {
            return
        }
        FlashcardsObservability.logStorageFullRecovery(
            installationId: installationId,
            pendingOutboxOperationCount: readStorageDiagnosticOutboxCount(
                databaseURL: databaseURL,
                workspaceId: workspaceId
            )
        )
    }
}

private func readStorageDiagnosticOutboxCount(databaseURL: URL, workspaceId: String) -> Int? {
    // A diagnostic reader must not wait for the sync writer or another connection.
    guard let core = try? DatabaseCore(readOnlyDatabaseURL: databaseURL),
          sqlite3_busy_timeout(core.connection, 0) == SQLITE_OK else {
        return nil
    }
    return try? OutboxStore(core: core).pendingOperationCount(workspaceId: workspaceId)
}

@MainActor
extension FlashcardsStore {
    func pendingStorageOutboxCount(installation: StorageDiagnosticInstallation) -> Int? {
        guard self.cloudSettings?.installationId == installation.id,
              let workspaceId = installation.workspaceId,
              self.cloudSettings?.activeWorkspaceId == workspaceId,
              let databaseURL = self.database?.databaseURL else {
            return nil
        }
        return readStorageDiagnosticOutboxCount(databaseURL: databaseURL, workspaceId: workspaceId)
    }
}
