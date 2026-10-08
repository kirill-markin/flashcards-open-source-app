import SwiftUI

struct AICompanionToolbarItem: ToolbarContent {
    @Environment(AppNavigationModel.self) private var navigation
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some ToolbarContent {
        // On iPad the open pane owns its hide action; other devices keep their host toggle.
        if (UIDevice.current.userInterfaceIdiom == .pad && self.navigation.isAICompanionVisible == false)
            || (UIDevice.current.userInterfaceIdiom != .pad
                && (self.horizontalSizeClass == .regular || self.navigation.isAICompanionVisible)) {
            if #available(iOS 26.0, *) {
                if UIDevice.current.userInterfaceIdiom != .pad {
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItem(placement: AICompanionToolbarButton.placement) {
                    AICompanionToolbarButton()
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .controlSize(.large)
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
    @Environment(AppNavigationModel.self) private var navigation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static var placement: ToolbarItemPlacement {
        if UIDevice.current.userInterfaceIdiom == .pad {
            return .topBarLeading
        }
        if #available(iOS 27.0, *) {
            return .topBarPinnedTrailing
        }
        return .primaryAction
    }

    var body: some View {
        Button {
            withAnimation(self.reduceMotion ? nil : .smooth(duration: 0.35)) {
                self.navigation.isAICompanionPresented.toggle()
            }
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
