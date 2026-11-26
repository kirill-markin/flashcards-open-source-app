import SwiftUI

extension AIChatView {
    /// The Mac pane's controls join the window toolbar. On iOS they join the bar of the pane's stack: its own on Duo,
    /// its section's on iPad.
    var usesCompactCompanionToolbar: Bool {
        #if targetEnvironment(macCatalyst)
        self.isCompanion && self.isPresentationActive
        #else
        false
        #endif
    }

    #if !targetEnvironment(macCatalyst)
    @ToolbarContentBuilder
    var companionPaneToolbar: some ToolbarContent {
        if UIDevice.current.userInterfaceIdiom == .pad {
            self.sectionBarCompanionToolbar
        } else {
            self.ownBarCompanionToolbar
        }
    }

    /// On iPad the chat's controls join its section's bar. They all lead, so they stay clear of a floating tab bar
    /// centred over the window and of the section's own trailing controls. As above the Duo pane's pushed pages,
    /// History and New belong to the live chat; a page's Back is in its heading.
    @ToolbarContentBuilder
    private var sectionBarCompanionToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            AICompanionToolbarButton()
                .labelStyle(.iconOnly)
        }
        if #available(iOS 26.0, *) {
            ToolbarSpacer(.fixed, placement: .topBarLeading)
        }
        if self.navigation.aiCompanionPath.isEmpty {
            ToolbarItemGroup(placement: .topBarLeading) {
                self.historyButton(usesToolbarIconLabel: false)
                    .disabled(self.isPresentationActive == false)
                if self.accessState == .ready {
                    self.newCompanionChatLabelButton
                        .labelStyle(.iconOnly)
                        .disabled(self.isPresentationActive == false)
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var ownBarCompanionToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            AICompanionToolbarButton()
                .labelStyle(.iconOnly)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            self.historyButton(usesToolbarIconLabel: false)
                .disabled(self.isPresentationActive == false)
            if self.accessState == .ready {
                self.newCompanionChatLabelButton
                    .labelStyle(.iconOnly)
                    .disabled(self.isPresentationActive == false)
            }
        }
    }
    #else
    /// The pane's top row, level with its section's toolbar: the controls lead and, like the section, it has no title.
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
            self.companionToggleButton
            self.companionHistoryButton
            if self.accessState == .ready {
                self.newCompanionChatButton
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, aiChatCompanionHeaderHorizontalPadding)
        .padding(.bottom, aiChatCompanionHeaderBottomPadding)
        .disabled(self.isPresentationActive == false)
    }
    #endif

    private var companionToggleButton: some View {
        AICompanionToolbarButton()
            .nativeToolbarIconButton()
    }

    private var companionHistoryButton: some View {
        self.historyButton(usesToolbarIconLabel: true)
            .nativeToolbarIconButton()
    }

    private var newCompanionChatButton: some View {
        self.newCompanionChatLabelButton
            .nativeToolbarIconButton()
    }

    private var newCompanionChatLabelButton: some View {
        Button(action: self.startNewChat) {
            Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
                .nativeToolbarIconLabel()
        }
        .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
        .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)
        .tint(Color.primary)
    }
}

/// The leading inset of the section's navigation bar items, so the pane's row lines up with the section's toolbar.
let aiChatCompanionHeaderHorizontalPadding: CGFloat = 10
#if targetEnvironment(macCatalyst)
let aiChatCompanionHeaderBottomPadding: CGFloat = 8
#endif
