import Foundation

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
    case deckCatalog
    case catalogDeck(CatalogBrowseIndexDeck)
    case importData
    case importAnki
    case exportData
    case exportFormat(WorkspacePackageExportFormat)
}

/// A first-level Library page: a hub row, and on the Mac sidebar a row under Library.
enum LibrarySection: Hashable, CaseIterable, Sendable {
    case cards
    case tags
    case decks
    case deckCatalog
    case importData
    case exportData

    var destination: LibraryNavigationDestination {
        switch self {
        case .cards: .cards
        case .tags: .tags
        case .decks: .decks
        case .deckCatalog: .deckCatalog
        case .importData: .importData
        case .exportData: .exportData
        }
    }

    var localizedTitle: String {
        switch self {
        case .cards: String(localized: "Cards", table: "ReviewCards")
        case .tags: aiSettingsLocalized("settings.workspace.row.tags", "Tags")
        case .decks: aiSettingsLocalized("settings.workspace.row.decks", "Decks")
        case .deckCatalog: String(localized: "library.row.deck_catalog.title", table: "Foundation")
        case .importData: aiSettingsLocalized("settings.workspace.import.title", "Import")
        case .exportData: String(localized: "library.row.export.title", table: "Foundation")
        }
    }

    var systemImage: String {
        switch self {
        case .cards: "rectangle.stack"
        case .tags: "tag"
        case .decks: "square.stack.3d.up"
        case .deckCatalog: "rectangle.stack.badge.plus"
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
