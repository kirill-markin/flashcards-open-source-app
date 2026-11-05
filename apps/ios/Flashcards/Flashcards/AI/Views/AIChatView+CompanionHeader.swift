import SwiftUI

extension AIChatView {
    var usesCompactCompanionToolbar: Bool {
        #if targetEnvironment(macCatalyst)
        self.isCompanion && self.isPresentationActive
        #else
        self.isCompanion && self.isPresentationActive
            && UIDevice.current.userInterfaceIdiom == .pad
            && self.companionHostTab != .library
            && (self.companionHostTab != .review || self.tabBarPlacement == .topBar)
        #endif
    }

    #if !targetEnvironment(macCatalyst)
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

            ToolbarItem(placement: self.companionNewChatToolbarPlacement) {
                self.historyToolbarButton
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
    #endif

    /// Sidebar Review, Library and phone companions keep controls inside the inset header;
    /// Library's pane sits beside its navigation stack, outside any navigation bar.
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

            self.historyToolbarButton
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
            .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
            .contentShape(Rectangle())
    }

    @ViewBuilder
    private var newCompanionChatButton: some View {
        let button = Button(action: self.startNewChat) {
            Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
                .frame(minWidth: UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil, minHeight: UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
        .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)

        if UIDevice.current.userInterfaceIdiom == .pad {
            button
                .font(.title3)
                .tint(Color.primary)
                .nativeActionButtonStyle()
                .controlSize(.regular)
                .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                .contentShape(Rectangle())
        } else {
            button
        }
    }
}
