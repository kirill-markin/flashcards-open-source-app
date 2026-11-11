import Foundation

/**
 Keep workspace navigation aligned with web and Android:
 the primary destinations are Review, Progress, AI, Library, and Settings,
 with shared first-level Library and Settings rows across supported clients
 (`LibrarySection` and `SettingsNavigationDestination` in `AppNavigationTypes.swift`).
 Android keeps the same product destinations
 in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/TopLevelDestinations.kt`,
 with nested settings destinations in `apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/settings/SettingsDestinations.kt`.
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
