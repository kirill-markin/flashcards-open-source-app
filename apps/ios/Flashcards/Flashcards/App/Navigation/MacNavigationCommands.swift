#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

/// One window's sidebar state for the View menu. `RootTabView` keeps `isSidebarVisible` current,
/// and its toolbar coordinator runs and clears `toggleRequestID`.
@MainActor
@Observable
final class MacSidebarCommandTarget {
    var isSidebarVisible: Bool = true
    var toggleRequestID: UUID? = nil
}

extension EnvironmentValues {
    @Entry var macSidebarCommandTarget: MacSidebarCommandTarget? = nil
}

extension FocusedValues {
    @Entry var macSidebarCommandTarget: MacSidebarCommandTarget?
}

extension View {
    /// Owns the window's sidebar target outside `ReviewKeyCommandHost`, whose inner scene values the menu bar cannot see.
    func macSidebarCommandOwner() -> some View {
        self.modifier(MacSidebarCommandOwner())
    }
}

private struct MacSidebarCommandOwner: ViewModifier {
    @State private var target: MacSidebarCommandTarget = MacSidebarCommandTarget()

    func body(content: Content) -> some View {
        content
            .environment(\.macSidebarCommandTarget, self.target)
            .focusedSceneValue(\.macSidebarCommandTarget, self.target)
    }
}

/// The View menu's ⌘ destinations; the sidebar rows show the same keys in their tooltips.
enum MacNavigationShortcut: CaseIterable {
    case review
    case progress
    case ai
    case cards
    case settings

    var key: KeyEquivalent {
        switch self {
        case .review: "1"
        case .progress: "2"
        case .ai: "3"
        case .cards: "4"
        case .settings: "5"
        }
    }

    var localizedTitle: String {
        switch self {
        case .review: AppTab.review.localizedTitle
        case .progress: AppTab.progress.localizedTitle
        case .ai: AppTab.ai.localizedTitle
        case .cards: LibrarySection.cards.localizedTitle
        case .settings: AppTab.settings.localizedTitle
        }
    }
}

/// The app menu's Settings key; the sidebar's Settings tooltip shows it instead of ⌘5.
let macAppSettingsShortcutKey: KeyEquivalent = ","

extension View {
    /// The native tooltip of a sidebar row, over the whole row rather than only its label.
    func macSidebarShortcutHelp(title: String, key: KeyEquivalent) -> some View {
        self.frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .help(String(
                format: String(localized: "mac.sidebar.row.tooltip", table: "Foundation"),
                locale: Locale.current,
                title,
                "⌘\(key.character)"
            ))
    }
}

struct MacNavigationCommands: Commands {
    let navigation: AppNavigationModel
    let isAvailable: Bool
    @FocusedValue(\.macSidebarCommandTarget) private var sidebarTarget: MacSidebarCommandTarget?

    var body: some Commands {
        // Card text is plain, so Format's Bold must not claim ⌘B.
        CommandGroup(replacing: .textFormatting) {}
        // Added after, not replacing, .sidebar: that system group also holds Enter Full Screen.
        CommandGroup(after: .sidebar) {
            Button(String(localized: self.sidebarTarget?.isSidebarVisible == false ? "mac.sidebar.show" : "mac.sidebar.hide", table: "Foundation")) {
                self.perform { self.sidebarTarget?.toggleRequestID = UUID() }
            }
            .keyboardShortcut("b", modifiers: .command)
            .disabled(self.isAvailable == false || self.sidebarTarget == nil)
            Divider()
            ForEach(MacNavigationShortcut.allCases, id: \.self) { shortcut in
                Button(shortcut.localizedTitle) {
                    self.perform { self.open(shortcut) }
                }
                .keyboardShortcut(shortcut.key, modifiers: .command)
                .disabled(self.isAvailable == false)
            }
            Divider()
            Button(String(localized: self.navigation.isAICompanionVisible ? "ai_companion.hide" : "ai_companion.show", table: "Foundation")) {
                self.perform { self.navigation.toggleAICompanion() }
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(self.isAvailable == false || self.navigation.canPresentAICompanion == false
                      || self.navigation.selectedTab == .ai || self.navigation.selectedTab == .settings)
        }
        CommandGroup(replacing: .appSettings) {
            Button(AppTab.settings.localizedTitle) {
                self.perform {
                    self.navigation.settingsPath = SettingsNavigationPath()
                    self.navigation.selectTab(.settings)
                }
            }
            .keyboardShortcut(macAppSettingsShortcutKey, modifiers: .command)
            .disabled(self.isAvailable == false)
        }
        CommandGroup(after: .newItem) {
            Button(String(localized: "New card", table: "ReviewCards")) {
                self.perform {
                    Analytics.track(
                        .cardCreateStarted(entryPoint: .quickAction),
                        screen: self.navigation.visibleAnalyticsSurface(tab: self.navigation.selectedTab)
                    )
                    self.navigation.openCardCreation()
                }
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
            .disabled(self.isAvailable == false)
        }
        CommandGroup(after: .pasteboard) {
            Button(String(localized: "Search cards", table: "ReviewCards")) {
                self.perform { self.navigation.searchCards() }
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])
            .disabled(self.isAvailable == false)
        }
    }

    private func open(_ shortcut: MacNavigationShortcut) {
        switch shortcut {
        case .review: self.navigation.selectTab(.review)
        case .progress: self.navigation.selectTab(.progress)
        case .ai: self.navigation.selectTab(.ai)
        case .cards:
            // Before the tab switch, so it reports the section's page.
            self.navigation.showLibrarySection(.cards)
            self.navigation.selectTab(.library)
        case .settings: self.navigation.selectTab(.settings)
        }
    }

    private func perform(_ action: () -> Void) {
        // Check at activation time: a menu can outlive the presentation that opened it.
        // Never navigate behind an editor, confirmation or system file picker.
        guard self.isAvailable,
              let scene = UIApplication.shared.connectedScenes.first(where: {
                  $0.activationState == .foregroundActive && ($0 as? UIWindowScene)?.keyWindow != nil
              }) as? UIWindowScene,
              let root = scene.keyWindow?.rootViewController else { return }
        guard hasCoveringPresentation(root) == false else { return }
        action()
    }
}
#endif
