#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

struct MacNavigationCommands: Commands {
    let navigation: AppNavigationModel
    let isAvailable: Bool

    var body: some Commands {
        CommandGroup(after: .sidebar) {
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
                self.perform { self.navigation.openCardCreation() }
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
