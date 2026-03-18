import Foundation
import OSLog

enum CloudFlowPhase: String {
    case authSendCode = "auth_send_code"
    case authVerifyCode = "auth_verify_code"
    case authSignInPassword = "auth_sign_in_password"
    case workspaceList = "workspace_list"
    case workspaceCreate = "workspace_create"
    case workspaceSelect = "workspace_select"
    case linkLocalWorkspace = "link_local_workspace"
    case initialPush = "initial_push"
    case initialPull = "initial_pull"
    case linkedSync = "linked_sync"
}

private let cloudLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "flashcards-open-source-app",
    category: "cloud"
)

func logCloudFlowPhase(
    phase: CloudFlowPhase,
    outcome: String,
    requestId: String? = nil,
    code: String? = nil,
    statusCode: Int? = nil,
    workspaceId: String? = nil,
    deviceId: String? = nil,
    selection: String? = nil,
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
        deviceId=\(deviceId ?? "-", privacy: .public) \
        selection=\(selection ?? "-", privacy: .public) \
        operations=\(operationsCount.map(String.init) ?? "-", privacy: .public) \
        changes=\(changesCount.map(String.init) ?? "-", privacy: .public) \
        error=\(errorMessage ?? "-", privacy: .public)
        """
    )
}
