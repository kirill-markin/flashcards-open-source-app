import Foundation

/**
 Keep workspace navigation aligned with web and Android:
 the primary destinations are Review, Progress, AI, Library, and Settings,
 with shared first-level Library and Settings rows across supported clients.
 Android keeps the same product destinations
 in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/TopLevelDestinations.kt`,
 with nested settings destinations in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/SettingsDestinations.kt`.
 */
enum AppTab: Hashable, CaseIterable, Sendable {
    case review
    case progress
    case ai
    case library
    case settings

    var localizedTitle: String {
        let key: String
        switch self {
        case .review: key = "root_tab.review.title"
        case .progress: key = "root_tab.progress.title"
        case .ai: key = "root_tab.ai.title"
        case .library: key = "root_tab.library.title"
        case .settings: key = "root_tab.settings.title"
        }
        return String(localized: String.LocalizationValue(key), table: "Foundation")
    }

    var systemImage: String {
        switch self {
        case .review: "rectangle.on.rectangle"
        case .progress: "chart.bar.xaxis"
        case .ai: "sparkles.rectangle.stack"
        case .library: "books.vertical"
        case .settings: "gearshape"
        }
    }
}

enum ProgressPresentationTarget: Hashable, Sendable {
    case streak
    case leaderboard
}

struct ProgressPresentationRequest: Hashable, Sendable {
    let id: UUID
    let target: ProgressPresentationTarget
}

enum LibraryNavigationDestination: Hashable, Sendable {
    case cards
    case tags
    case decks
    case deckDetail(DeckScreenDestination)
    case importData
    case exportData
}

/// A first-level Library page: a hub row, and on the Mac sidebar a row under Library.
enum LibrarySection: Hashable, CaseIterable, Sendable {
    case cards
    case tags
    case decks
    case importData
    case exportData

    var destination: LibraryNavigationDestination {
        switch self {
        case .cards: .cards
        case .tags: .tags
        case .decks: .decks
        case .importData: .importData
        case .exportData: .exportData
        }
    }

    var localizedTitle: String {
        switch self {
        case .cards: String(localized: "Cards", table: "ReviewCards")
        case .tags: aiSettingsLocalized("settings.workspace.row.tags", "Tags")
        case .decks: aiSettingsLocalized("settings.workspace.row.decks", "Decks")
        case .importData: aiSettingsLocalized("settings.workspace.import.title", "Import")
        case .exportData: aiSettingsLocalized("settings.workspace.row.export", "Export")
        }
    }

    var systemImage: String {
        switch self {
        case .cards: "rectangle.stack"
        case .tags: "tag"
        case .decks: "square.stack.3d.up"
        case .importData: "square.and.arrow.down"
        case .exportData: "square.and.arrow.up"
        }
    }
}

enum SettingsNavigationDestination: Hashable, Sendable {
    case subscription
    case currentWorkspace
    case theme
    case accentColor
    case reviewAnimations
    case aiChatSuggestions
    case appIcon
    case ownOpenAIKey
    case leaderboardParticipation
    case productAnalytics
    case language
    case feedback
    case device
    case access
    case accessPermissionDetail(AccessPermissionKind)
    case test
    case testAnimations
    case notificationDiagnostics
    case localSyncDiagnostics
    case notifications
    case workspaceScheduler
    case accountStatus
    case accountLegal
    case accountSupport
    case accountOpenSource
    case accountServer
    case accountAgentConnections
    case accountDangerZone
    case resetStudyProgress
    case deleteCurrentWorkspace
}
