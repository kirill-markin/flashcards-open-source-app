import SwiftUI

struct AICompanionToolbarItem: ToolbarContent {
    var body: some ToolbarContent {
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: AICompanionToolbarButton.placement) {
                AICompanionToolbarButton()
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
            }
            // Native grouping isolates the action; its native button style supplies the glass.
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: AICompanionToolbarButton.placement) {
                AICompanionToolbarButton()
            }
        }
    }
}

struct AICompanionToolbarButton: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    static var placement: ToolbarItemPlacement {
        if #available(iOS 27.0, *) {
            // Keep the single show/hide action visible when the native toolbar overflows.
            return .topBarPinnedTrailing
        }
        return .primaryAction
    }

    var body: some View {
        if self.horizontalSizeClass == .regular || self.navigation.isAICompanionVisible {
            Button {
                self.navigation.isAICompanionPresented.toggle()
            } label: {
                Label(
                    String(localized: self.navigation.isAICompanionVisible
                           ? "ai_companion.hide" : "ai_companion.show", table: "Foundation"),
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
            .accessibilityIdentifier(UITestIdentifier.aiCompanionToggle)
        }
    }
}
