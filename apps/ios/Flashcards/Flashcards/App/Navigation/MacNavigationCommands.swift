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
            ForEach(Array(AppTab.allCases.enumerated()), id: \.element) { index, tab in
                Button(tab.localizedTitle) {
                    self.perform { self.navigation.selectTab(tab) }
                }
                .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
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
            .keyboardShortcut(",", modifiers: .command)
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
