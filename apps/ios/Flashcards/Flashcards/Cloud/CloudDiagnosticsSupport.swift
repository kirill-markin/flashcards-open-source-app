import Foundation

enum CloudFlowPhase: String, Sendable, Hashable {
    case authSendCode = "auth_send_code"
    case authVerifyCode = "auth_verify_code"
    case authRefreshToken = "auth_refresh_token"
    case authRequest = "auth_request"
    case guestSessionCreate = "guest_session_create"
    case guestSessionDelete = "guest_session_delete"
    case guestUpgradePrepare = "guest_upgrade_prepare"
    case guestUpgradeComplete = "guest_upgrade_complete"
    case guestAuthRequest = "guest_auth_request"
    case workspaceList = "workspace_list"
    case workspaceCreate = "workspace_create"
    case workspaceSelect = "workspace_select"
    case cloudSyncRequest = "cloud_sync_request"
    case linkLocalWorkspace = "link_local_workspace"
    case initialPush = "initial_push"
    case initialPull = "initial_pull"
    case linkedSync = "linked_sync"
}

func logCloudFlowPhase(
    phase: CloudFlowPhase,
    outcome: String,
    requestId: String? = nil,
    code: String? = nil,
    statusCode: Int? = nil,
    workspaceId: String? = nil,
    installationId: String? = nil,
    selection: String? = nil,
    sourceWorkspaceId: String? = nil,
    targetWorkspaceId: String? = nil,
    migrationKind: String? = nil,
    remoteWorkspaceIsEmpty: Bool? = nil,
    operationsCount: Int? = nil,
    reviewScheduleImpactingOperationCount: Int? = nil,
    changesCount: Int? = nil,
    errorMessage: String? = nil
) {
    let cloudOutcome: CloudFlowOutcome
    switch outcome {
    case CloudFlowOutcome.start.rawValue:
        cloudOutcome = .start
    case CloudFlowOutcome.success.rawValue:
        cloudOutcome = .success
    case CloudFlowOutcome.failure.rawValue:
        cloudOutcome = .failure
    case CloudFlowOutcome.selfHeal.rawValue:
        cloudOutcome = .selfHeal
    default:
        cloudOutcome = .failure
    }

    let scope = IOSObservationScope(
        feature: cloudObservationFeature(phase: phase),
        userId: nil,
        workspaceId: workspaceId ?? targetWorkspaceId,
        requestId: requestId,
        clientRequestId: nil,
        sessionId: nil,
        runId: nil,
        cloudState: nil,
        configurationMode: nil
    )
    let observation = CloudFlowObservation(
        phase: phase,
        outcome: cloudOutcome,
        scope: scope,
        requestId: requestId,
        backendCode: code,
        statusCode: statusCode,
        workspaceId: workspaceId,
        installationId: installationId,
        selection: selection,
        sourceWorkspaceId: sourceWorkspaceId,
        targetWorkspaceId: targetWorkspaceId,
        migrationKind: migrationKind,
        remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty,
        operationsCount: operationsCount,
        reviewScheduleImpactingOperationCount: reviewScheduleImpactingOperationCount,
        changesCount: changesCount,
        errorSummary: errorMessage
    )
    if cloudOutcome == .selfHeal {
        FlashcardsObservability.addBreadcrumb(.cloudFlow(observation))
        FlashcardsObservability.captureWarning(.cloudFlow(observation))
        return
    }
    FlashcardsObservability.addBreadcrumb(.cloudFlow(observation))
}

private func cloudObservationFeature(phase: CloudFlowPhase) -> IOSObservationFeature {
    switch phase {
    case .authSendCode,
            .authRefreshToken,
            .authVerifyCode,
            .authRequest,
            .guestSessionCreate,
            .guestSessionDelete,
            .guestUpgradePrepare,
            .guestUpgradeComplete,
            .guestAuthRequest:
        return .cloudAuth
    case .workspaceList,
            .workspaceCreate,
            .workspaceSelect,
            .cloudSyncRequest,
            .linkLocalWorkspace,
            .initialPush,
            .initialPull,
            .linkedSync:
        return .cloudSync
    }
}
