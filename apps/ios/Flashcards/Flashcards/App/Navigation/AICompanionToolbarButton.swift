import SwiftUI

#if !targetEnvironment(macCatalyst)
/// The companion is presented only in a regular-width window, so its toggle follows the regular toolbar layout.
struct AICompanionToolbarItem: ToolbarContent {
    @Environment(AppNavigationModel.self) private var navigation

    var body: some ToolbarContent {
        // The open pane owns its hide action.
        if self.navigation.canPresentAICompanion && self.navigation.isAICompanionVisible == false {
            if #available(iOS 26.0, *) {
                ToolbarItem(placement: .topBarLeading) {
                    AICompanionToolbarButton()
                        .nativeToolbarIconButton()
                }
                .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) {
                    AICompanionToolbarButton()
                }
            }
        }
    }
}
#endif

struct AICompanionToolbarButton: View {
    @Environment(AppNavigationModel.self) private var navigation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        self.button
            .nativeToolbarState(isActive: self.navigation.isAICompanionVisible)
    }

    @ViewBuilder
    private var button: some View {
        let action = {
            withAnimation(self.reduceMotion ? nil : .smooth(duration: 0.35)) {
                self.navigation.toggleAICompanion()
            }
        }
        Button(action: action) {
            Label(
                String(localized: self.navigation.isAICompanionVisible
                       ? "ai_companion.hide" : "ai_companion.show", table: "Foundation"),
                systemImage: "bubble.left.and.bubble.right"
            )
            .nativeToolbarIconLabel()
        }
        .accessibilityIdentifier(UITestIdentifier.aiCompanionToggle)
    }
}
