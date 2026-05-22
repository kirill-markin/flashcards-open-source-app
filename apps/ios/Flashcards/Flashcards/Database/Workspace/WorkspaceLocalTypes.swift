import Foundation

struct Workspace: Codable, Hashable, Sendable {
    let workspaceId: String
    let name: String
    let createdAt: String
}

struct UserSettings: Codable, Hashable, Sendable {
    let userId: String
    let workspaceId: String
    let email: String?
    let locale: String
    let createdAt: String
}

struct BootstrapSnapshotRefreshOutcome: Hashable, Sendable {
    let didChange: Bool
    let workspaceChanged: Bool
    let cardsChanged: Bool
    let homeSnapshotChanged: Bool
}

struct AppBootstrapSnapshot: Hashable, Sendable {
    let workspace: Workspace
    let userSettings: UserSettings
    let schedulerSettings: WorkspaceSchedulerSettings
    let cloudSettings: CloudSettings
}
