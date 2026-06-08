import Foundation

/**
 Keep workspace navigation aligned with web and Android:
 the primary destinations are Review, Progress, AI, Cards, and Settings,
 with shared first-level Settings rows across supported clients.
 Android keeps the same product destinations
 in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/TopLevelDestinations.kt`,
 with nested settings destinations in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/SettingsDestinations.kt`.
 */
enum AppTab: Hashable, CaseIterable, Sendable {
    case review
    case progress
    case ai
    case cards
    case settings
}

enum SettingsNavigationDestination: Hashable, Sendable {
    case currentWorkspace
    case reviewAnimations
    case language
    case feedback
    case device
    case access
    case accessPermissionDetail(AccessPermissionKind)
    case test
    case testAnimations
    case workspace
    case workspaceNotifications
    case workspaceOverview
    case workspaceScheduler
    case workspaceExport
    case workspaceDecks
    case workspaceTags
    case account
    case accountStatus
    case accountLegal
    case accountSupport
    case accountOpenSource
    case accountAdvanced
    case accountServer
    case accountAgentConnections
    case accountDangerZone
    case resetStudyProgress
    case deleteCurrentWorkspace
}
