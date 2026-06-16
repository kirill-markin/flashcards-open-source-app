import Foundation

private let syncWorkspaceForkRequiredErrorCode: String = "SYNC_WORKSPACE_FORK_REQUIRED"
private let maxPublicWorkspaceForkRecoveriesPerSync: Int = 10

struct PublicWorkspaceForkRecoveryKey: Hashable {
    let entityType: SyncEntityType
    let entityId: String
}

struct PublicWorkspaceForkRecoveryResult: Hashable {
    let key: PublicWorkspaceForkRecoveryKey
    let entityType: SyncEntityType
}

struct CloudSyncLocalIdRepairFailure: LocalizedError, @unchecked Sendable {
    let syncResult: CloudSyncResult
    let underlyingError: Error

    var errorDescription: String? {
        if let errorDescription = (self.underlyingError as? LocalizedError)?.errorDescription {
            return errorDescription
        }

        return self.underlyingError.localizedDescription
    }
}

extension CloudSyncRunner {
    func repairPublicWorkspaceForkConflictIfNeeded(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        error: Error,
        repairedConflicts: Set<PublicWorkspaceForkRecoveryKey>
    ) throws -> PublicWorkspaceForkRecoveryResult? {
        guard linkedSession.authorization.isGuest == false else {
            return nil
        }
        guard let syncError = error as? CloudSyncError else {
            return nil
        }
        guard case .invalidResponse(let details, let statusCode) = syncError else {
            return nil
        }
        guard details.code == syncWorkspaceForkRequiredErrorCode else {
            return nil
        }
        guard let syncConflict = details.syncConflict, syncConflict.recoverable else {
            return nil
        }
        let recoveryKey = PublicWorkspaceForkRecoveryKey(
            entityType: syncConflict.entityType,
            entityId: syncConflict.entityId
        )
        guard repairedConflicts.contains(recoveryKey) == false else {
            let conflictDescription = "\(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "automatic local id repair already repaired \(conflictDescription) in this sync attempt and the backend still reports the same conflict"
            )
        }
        guard repairedConflicts.count < maxPublicWorkspaceForkRecoveriesPerSync else {
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "automatic local id repair reached the limit of \(maxPublicWorkspaceForkRecoveriesPerSync) distinct conflicts in this sync attempt"
            )
        }

        do {
            let recovery = try self.database.repairLocalIdForPublicSyncConflict(
                workspaceId: workspaceId,
                syncConflict: syncConflict
            )
            return PublicWorkspaceForkRecoveryResult(
                key: recoveryKey,
                entityType: recovery.entityType
            )
        } catch {
            let repairErrorMessage: String = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "local id repair failed: \(repairErrorMessage)"
            )
        }
    }

    private func makePublicWorkspaceForkRecoveryBlockedError(
        details: CloudApiErrorDetails,
        statusCode: Int,
        reason: String
    ) -> CloudSyncError {
        let entityDescription: String
        if let syncConflict = details.syncConflict {
            entityDescription = "\(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
        } else {
            entityDescription = "the conflicting local entity"
        }

        return .invalidResponse(
            CloudApiErrorDetails(
                message: "Cloud sync is blocked because automatic local id repair for \(entityDescription) could not complete: \(reason).",
                requestId: details.requestId,
                code: syncWorkspaceForkRequiredErrorCode,
                syncConflict: details.syncConflict
            ),
            statusCode
        )
    }

    func makeLocalIdRepairSyncResult(changedEntityTypes: Set<SyncEntityType>) -> CloudSyncResult {
        CloudSyncResult(
            appliedPullChangeCount: 0,
            reviewScheduleImpactingPullChangeCount: 0,
            changedEntityTypes: changedEntityTypes,
            localIdRepairEntityTypes: changedEntityTypes,
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            acknowledgedReviewScheduleImpactingOperationCount: 0,
            cleanedUpOperationCount: 0,
            cleanedUpReviewEventOperationCount: 0,
            cleanedUpReviewScheduleImpactingOperationCount: 0
        )
    }

    func wrapFailureAfterLocalIdRepairIfNeeded(
        error: Error,
        changedEntityTypes: Set<SyncEntityType>
    ) -> Error {
        guard changedEntityTypes.isEmpty == false else {
            return error
        }

        return CloudSyncLocalIdRepairFailure(
            syncResult: self.makeLocalIdRepairSyncResult(changedEntityTypes: changedEntityTypes),
            underlyingError: error
        )
    }
}
