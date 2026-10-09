import SwiftUI

struct AICompanionToolbarItem: ToolbarContent {
    @Environment(AppNavigationModel.self) private var navigation

    var body: some ToolbarContent {
        // On iPad the open pane owns its hide action; other devices keep their host toggle.
        if self.navigation.canPresentAICompanion
            && (UIDevice.current.userInterfaceIdiom != .pad || self.navigation.isAICompanionVisible == false) {
            if #available(iOS 26.0, *) {
                if UIDevice.current.userInterfaceIdiom != .pad {
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItem(placement: AICompanionToolbarButton.placement) {
                    AICompanionToolbarButton(labelMinimumSize: UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .controlSize(UIDevice.current.userInterfaceIdiom == .pad ? .regular : .large)
                }
                .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: AICompanionToolbarButton.placement) {
                    AICompanionToolbarButton()
                }
            }
        }
    }
}

struct AICompanionToolbarButton: View {
    var labelMinimumSize: CGFloat? = nil

    @Environment(AppNavigationModel.self) private var navigation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static var placement: ToolbarItemPlacement {
        if UIDevice.current.userInterfaceIdiom == .pad {
            return .topBarLeading
        }
        return .primaryAction
    }

    @ViewBuilder
    var body: some View {
        if UIDevice.current.userInterfaceIdiom == .pad {
            self.button
                .tint(self.navigation.isAICompanionVisible ? Color.accentColor : Color.primary)
        } else {
            self.button
        }
    }

    private var button: some View {
        Button {
            withAnimation(self.reduceMotion ? nil : .smooth(duration: 0.35)) {
                self.navigation.toggleAICompanion()
            }
        } label: {
            Label(
                String(localized: self.navigation.isAICompanionVisible
                       ? "ai_companion.hide" : "ai_companion.show", table: "Foundation"),
                systemImage: "bubble.left.and.bubble.right"
            )
            .frame(minWidth: self.labelMinimumSize, minHeight: self.labelMinimumSize)
        }
        .accessibilityIdentifier(UITestIdentifier.aiCompanionToggle)
    }
}
