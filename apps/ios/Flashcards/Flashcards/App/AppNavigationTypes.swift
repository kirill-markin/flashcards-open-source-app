import Foundation

/**
 Keep workspace navigation aligned with web and Android:
 the primary destinations are Review, Progress, AI, Cards, and Settings.
 Decks and tags belong under workspace settings on both platforms.
 Web exposes account settings from the account menu, while iOS nests account
 settings inside the Settings tab. Android keeps the same product destinations
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
    case device
    case access
    case accessPermissionDetail(AccessPermissionKind)
    case workspace
    case workspaceNotifications
    case workspaceOverview
    case workspaceScheduler
    case workspaceExport
    case workspaceDecks
    case workspaceTags
    case account
    case accountStatus
    case accountLegalSupport
    case accountOpenSource
    case accountAdvanced
    case accountServer
    case accountAgentConnections
    case accountDangerZone
}
