import SwiftUI

extension AIChatView {
    var usesCompactCompanionToolbar: Bool {
        self.isCompanion && self.isPresentationActive
            && UIDevice.current.userInterfaceIdiom == .pad
            && (self.companionHostTab != .review || self.tabBarPlacement == .topBar)
    }

    private var companionNewChatToolbarPlacement: ToolbarItemPlacement {
        self.usesCompactCompanionToolbar ? .topBarLeading : .topBarTrailing
    }

    @ToolbarContentBuilder
    var companionToolbarContent: some ToolbarContent {
        if self.isPresentationActive {
            if #available(iOS 26.0, *) {
                ToolbarItem(placement: .topBarLeading) {
                    self.companionToggleButton
                }
                .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .topBarLeading) {
                    self.companionToggleButton
                }
            }

            if self.accessState == .ready {
                if #available(iOS 26.0, *) {
                    ToolbarItem(placement: self.companionNewChatToolbarPlacement) {
                        self.newCompanionChatButton
                            .labelStyle(.iconOnly)
                            .buttonBorderShape(.circle)
                    }
                    .sharedBackgroundVisibility(.hidden)
                } else {
                    ToolbarItem(placement: self.companionNewChatToolbarPlacement) {
                        self.newCompanionChatButton
                            .labelStyle(.iconOnly)
                            .buttonBorderShape(.circle)
                    }
                }
            }
        }
    }

    /// Sidebar Review and phone companions keep controls inside the inset header.
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
                self.companionToggleButton
            }

            Text(aiSettingsLocalized("ai.title", "AI"))
                .font(.headline)
                .lineLimit(1)
                .frame(maxWidth: .infinity)

            if self.accessState == .ready {
                self.newCompanionChatButton
            }
        }
        .labelStyle(.iconOnly)
        .nativeActionButtonStyle()
        .buttonBorderShape(.circle)
        .controlSize(UIDevice.current.userInterfaceIdiom == .pad ? .regular : .large)
        .padding(.horizontal, self.chatContentHorizontalPadding)
        .padding(.top, UIDevice.current.userInterfaceIdiom == .pad ? 0 : 10)
        .padding(.bottom, 10)
        .disabled(self.isPresentationActive == false)
    }

    private var companionToggleButton: some View {
        AICompanionToolbarButton(labelMinimumSize: 30)
            .labelStyle(.iconOnly)
            .nativeActionButtonStyle()
            .buttonBorderShape(.circle)
            .controlSize(.regular)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }

    @ViewBuilder
    private var newCompanionChatButton: some View {
        let button = Button(action: self.startNewChat) {
            Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
                .frame(minWidth: UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil, minHeight: UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil)
        }
        .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
        .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)

        if UIDevice.current.userInterfaceIdiom == .pad {
            button
                .font(.title3)
                .tint(Color.primary)
                .nativeActionButtonStyle()
                .controlSize(.regular)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        } else {
            button
        }
    }
}
