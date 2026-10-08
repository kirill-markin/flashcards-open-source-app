import SwiftUI

extension AIChatView {
    /// Keep companion tools inside either pane or inspector, separate from the host toolbar.
    @ViewBuilder
    var companionHeader: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                self.companionHeaderContent
            }
        } else {
            self.companionHeaderContent
        }
    }

    private var companionHeaderContent: some View {
        HStack(spacing: 12) {
            if UIDevice.current.userInterfaceIdiom == .pad {
                AICompanionToolbarButton()
            }

            Text(aiSettingsLocalized("ai.title", "AI"))
                .font(.headline)
                .lineLimit(1)
                .frame(maxWidth: .infinity)

            if self.accessState == .ready {
                Button {
                    self.dismissComposerFocus()
                    self.chatStore.clearHistory()
                } label: {
                    Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
                }
                .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
                .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)
            }
        }
        .labelStyle(.iconOnly)
        .nativeActionButtonStyle()
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .disabled(self.isPresentationActive == false)
    }
}
