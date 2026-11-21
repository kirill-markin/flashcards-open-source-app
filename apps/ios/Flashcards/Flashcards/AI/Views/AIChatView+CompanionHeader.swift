import SwiftUI

extension AIChatView {
    /// The Mac pane's controls join the window toolbar. On iOS the pane draws its own row beside its section's bar.
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
    /// centred over the window and of the section's own trailing controls.
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
        } else {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: self.closeCompanionPage) {
                    Label {
                        // A long chat title must not reach a floating tab bar.
                        Text(self.companionBackTitle)
                            .lineLimit(1)
                            .frame(maxWidth: 160)
                    } icon: {
                        Image(systemName: "chevron.backward")
                    }
                    .labelStyle(.titleAndIcon)
                }
                .accessibilityIdentifier(UITestIdentifier.aiCompanionBackButton)
            }
        }
    }

    /// Like a native back button, it names the page it returns to.
    private var companionBackTitle: String {
        let path = self.navigation.aiCompanionPath
        guard path.count >= 2 else { return aiSettingsLocalized("ai.title", "AI") }
        switch path[path.count - 2] {
        case .history:
            return aiSettingsLocalized("ai.history.title", "Chat history")
        case .reader(let route):
            return route.summary.title ?? aiChatHistoryUntitledChatTitle()
        case .fullResponse:
            return aiSettingsLocalized("ai.message.fullResponse.title", "Full response")
        }
    }

    /// The pane's previous page, from the host the person sees.
    private func closeCompanionPage() {
        guard self.navigation.isAICompanionVisible, self.navigation.selectedTab == self.companionHostTab else { return }
        _ = self.navigation.aiCompanionPath.popLast()
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
