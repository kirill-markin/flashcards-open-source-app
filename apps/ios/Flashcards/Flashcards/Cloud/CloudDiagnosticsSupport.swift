import Foundation
import OSLog

enum CloudFlowPhase: String {
    case authSendCode = "auth_send_code"
    case authVerifyCode = "auth_verify_code"
    case workspaceList = "workspace_list"
    case workspaceCreate = "workspace_create"
    case workspaceSelect = "workspace_select"
    case linkLocalWorkspace = "link_local_workspace"
    case initialPush = "initial_push"
    case initialPull = "initial_pull"
    case linkedSync = "linked_sync"
}

private let cloudLogger = Logger(
    subsystem: appBundleIdentifier(),
    category: "cloud"
)

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
    changesCount: Int? = nil,
    errorMessage: String? = nil
) {
    cloudLogger.log(
        """
        phase=\(phase.rawValue, privacy: .public) \
        outcome=\(outcome, privacy: .public) \
        requestId=\(requestId ?? "-", privacy: .public) \
        code=\(code ?? "-", privacy: .public) \
        status=\(statusCode.map(String.init) ?? "-", privacy: .public) \
        workspaceId=\(workspaceId ?? "-", privacy: .public) \
        installationId=\(installationId ?? "-", privacy: .public) \
        selection=\(selection ?? "-", privacy: .public) \
        sourceWorkspaceId=\(sourceWorkspaceId ?? "-", privacy: .public) \
        targetWorkspaceId=\(targetWorkspaceId ?? "-", privacy: .public) \
        migrationKind=\(migrationKind ?? "-", privacy: .public) \
        remoteWorkspaceIsEmpty=\(remoteWorkspaceIsEmpty.map(String.init) ?? "-", privacy: .public) \
        operations=\(operationsCount.map(String.init) ?? "-", privacy: .public) \
        changes=\(changesCount.map(String.init) ?? "-", privacy: .public) \
        error=\(errorMessage ?? "-", privacy: .public)
        """
    )
}
