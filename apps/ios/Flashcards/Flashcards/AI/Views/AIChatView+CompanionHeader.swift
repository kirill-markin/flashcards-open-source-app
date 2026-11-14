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
    /// The pane's row on iOS while the live chat is on top. The toggle keeps its own circle; History and New share one
    /// glass pill, like Review's badges. Like the section, it has no title.
    @ViewBuilder
    var companionPaneHeader: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    self.companionToggleButton
                    HStack(spacing: 0) {
                        self.companionPillButton(self.historyButton(usesToolbarIconLabel: true))
                        if self.accessState == .ready {
                            self.companionPillButton(self.newCompanionChatLabelButton)
                        }
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, aiChatCompanionHeaderHorizontalPadding)
            .disabled(self.isPresentationActive == false)
        } else {
            HStack(spacing: 12) {
                self.companionToggleButton
                self.companionHistoryButton
                if self.accessState == .ready {
                    self.newCompanionChatButton
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, aiChatCompanionHeaderHorizontalPadding)
            .disabled(self.isPresentationActive == false)
        }
    }

    /// One segment of the glass pill: primary while usable and dimmed while disabled, at the toolbar's 44 points.
    private func companionPillButton<Control: View>(_ control: Control) -> some View {
        control
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
            .contentShape(Rectangle())
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
