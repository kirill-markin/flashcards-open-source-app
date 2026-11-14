import SwiftUI
import UIKit

@MainActor
func aiChatComposerAccessoryIcon(systemName: String) -> some View {
    #if targetEnvironment(macCatalyst)
    Image(systemName: systemName)
        .font(.system(size: 15, weight: .medium))
        .frame(width: 16, height: 16)
        .contentShape(Rectangle())
    #else
    AIChatComposerInlineIcon(systemName: systemName)
    #endif
}

#if !targetEnvironment(macCatalyst)
/// A plain button keeps its tint when disabled, so the glyph turns grey itself when its control cannot be used.
private struct AIChatComposerInlineIcon: View {
    @Environment(\.isEnabled) private var isEnabled
    let systemName: String

    var body: some View {
        Image(systemName: self.systemName)
            .font(.system(size: 20, weight: .medium))
            .foregroundStyle(self.isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
            .frame(width: aiChatComposerControlSize, height: aiChatComposerControlSize)
            .contentShape(Rectangle())
    }
}
#endif

extension View {
    /// Notices above the composer float over the transcript with nothing behind them, so they carry their own glass.
    @ViewBuilder
    func aiChatComposerNoticeBackground() -> some View {
        #if targetEnvironment(macCatalyst)
        self.padding(.horizontal, 12)
        #else
        self.padding(.horizontal, 12)
            .padding(.vertical, 8)
            .nativeTextInputBackground(cornerRadius: 16, isInteractive: false)
        #endif
    }
}

#if !targetEnvironment(macCatalyst)
/// The composer shell's measured width. A width animation changes it every frame, so only a width that moves the
/// draft between one row and its own lines notifies the views that read it. The decision's other inputs are observed
/// in the same body, so any of their changes re-reads the latest width.
@MainActor
final class AIChatComposerShellWidth: Observable {
    private let registrar = ObservationRegistrar()
    private var storedValue: CGFloat = 0

    var value: CGFloat {
        self.registrar.access(self, keyPath: \.value)
        return self.storedValue
    }

    func update(_ value: CGFloat, notifiesObservers: Bool) {
        if notifiesObservers {
            self.registrar.withMutation(of: self, keyPath: \.value) {
                self.storedValue = value
            }
        } else {
            self.storedValue = value
        }
    }
}
#endif

extension AIChatView {
    var composerAccessory: some View {
        @Bindable var chatStore = self.chatStore

        return ReadableContentLayout(
            maxWidth: flashcardsReadableContentMaxWidth,
            horizontalPadding: self.chatContentHorizontalPadding
        ) {
            VStack(alignment: .leading, spacing: aiChatComposerControlSpacing) {
                if self.chatStore.pendingAttachments.isEmpty == false {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(self.chatStore.pendingAttachments) { attachment in
                                HStack(spacing: 6) {
                                    switch attachment.payload {
                                    case .localFile(let fileName, _, _):
                                        Image(systemName: attachment.isImage ? "photo" : "doc")
                                            .foregroundStyle(.secondary)
                                            .fixedSize()
                                        Text(fileName)
                                            .font(.caption)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                    case .card(let card):
                                        Image(systemName: "square.stack")
                                            .foregroundStyle(.secondary)
                                            .fixedSize()
                                        MathContentText(text: aiChatCardAttachmentLabel(card: card), textStyle: .caption1, lineLimit: 1, parsedBlocks: aiChatCardAttachmentMathBlocks(card: card))
                                            .accessibilityIdentifier(UITestIdentifier.aiComposerCardAttachmentChip)
                                    case .unknown(let unknownAttachment):
                                        Image(systemName: "questionmark.square.dashed")
                                            .foregroundStyle(.secondary)
                                            .fixedSize()
                                        Text(
                                            aiSettingsLocalizedFormat(
                                                "ai.composer.attachment.unsupported",
                                                "Unsupported attachment (%@)",
                                                unknownAttachment.originalType
                                            )
                                        )
                                            .font(.caption)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                    }
                                    Button {
                                        self.chatStore.removeAttachment(id: attachment.id)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                            #if !targetEnvironment(macCatalyst)
                                            .frame(minWidth: 44, minHeight: 44)
                                            #endif
                                            .contentShape(Rectangle())
                                    }
                                    .nativeInlineActionButtonStyle()
                                    .fixedSize()
                                    .disabled(self.chatStore.canModifyDraftAttachments == false)
                                    .accessibilityLabel(aiSettingsLocalized("common.delete", "Delete"))
                                    .accessibilityValue(self.composerAttachmentAccessibilityValue(attachment))
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .frame(
                                    idealWidth: self.composerAttachmentViewportWidth,
                                    maxWidth: self.composerAttachmentViewportWidth,
                                    alignment: .leading
                                )
                                .background(.thinMaterial, in: Capsule())
                            }
                        }
                    }
                    .onGeometryChange(for: CGFloat.self) { geometry in
                        geometry.size.width
                    } action: { width in
                        self.composerAttachmentViewportWidth = width
                    }
                }

                if self.chatStore.isAIImportDraftBlocked {
                    Text(
                        aiSettingsLocalized(
                            "ai.composer.aiImport.unconfirmed",
                            "Couldn’t confirm the import. Check this chat and your Library before starting another import."
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .aiChatComposerNoticeBackground()
                }

                if self.chatStore.visibleComposerSuggestions.isEmpty == false {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(self.chatStore.visibleComposerSuggestions.enumerated()), id: \.element.id) { index, suggestion in
                                Button {
                                    self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
                                    self.chatStore.applyComposerSuggestion(suggestion)
                                    self.isComposerFocused = true
                                } label: {
                                    MathContentText(text: suggestion.text, textStyle: .footnote)
                                        .padding(.horizontal, aiChatComposerSuggestionHorizontalPadding)
                                        .padding(.vertical, aiChatComposerSuggestionVerticalPadding)
                                }
                                #if targetEnvironment(macCatalyst)
                                .buttonStyle(.bordered)
                                .buttonBorderShape(.capsule)
                                #else
                                .buttonStyle(.plain)
                                .background(.thinMaterial, in: Capsule())
                                .overlay { Capsule().strokeBorder(.tint.opacity(0.18), lineWidth: 1) }
                                #endif
                                .accessibilityIdentifier("\(UITestIdentifier.aiComposerSuggestionPrefix)\(index)")
                            }
                        }
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiComposerSuggestionRow)
                }

                if let remainingMessagesNotice = self.remainingMessagesNotice {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(remainingMessagesNotice)
                        if let entitlement = self.flashcardsStore.cloudEntitlement,
                           hasPremiumAccess(entitlement: entitlement) == false {
                            Button(aiSettingsLocalized("premium.offer.view", "View Premium")) {
                                self.premiumPresenter.present(
                                    reason: .premiumFeature(requiredTierRank: premiumTierRank),
                                    analyticsEntryPoint: .aiLowBalance,
                                    entitlement: entitlement,
                                    identity: try? self.flashcardsStore.appleSubscriptionIdentity()
                                )
                            }
                            .accessibilityIdentifier(UITestIdentifier.aiLowBalancePremiumButton)
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .aiChatComposerNoticeBackground()
                    .accessibilityIdentifier(UITestIdentifier.aiRemainingMessagesNotice)
                }

                self.composerDictationErrorNotice

                #if targetEnvironment(macCatalyst)
                self.macComposerShell
                #else
                self.composerShell
                #endif
            }
            .padding(.top, aiChatComposerTopPadding)
            .padding(.bottom, UIDevice.current.userInterfaceIdiom == .pad ? 8 : 16)
        }
    }

    #if targetEnvironment(macCatalyst)
    private var macComposerShell: some View {
        Group {
            ZStack(alignment: .bottomTrailing) {
                self.composerTextSlot(topContentInset: 0)
                    .padding(.leading, 12)
                    .padding(.top, aiChatComposerTextVerticalPadding)
                    .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    .padding(.bottom, aiChatComposerTextVerticalPadding)
                    .frame(minHeight: aiChatComposerSendButtonHitSize)
                    .background {
                        self.composerTextSlotFocusTarget
                    }

                self.composerPrimaryButton
            }
            .modifier(AIChatComposerDictationDraftLock(
                isLocked: self.chatStore.dictationState != .idle,
                lockedHeight: aiChatComposerSendButtonHitSize
            ))
            .overlay {
                self.composerDictationToolbar
            }
            .background {
                self.composerKeyboardObserver
            }
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            // Mac has no software keyboard to dismiss; Escape leaves the composer.
            HStack(spacing: 8) {
                if self.composerShowsAttachmentButton {
                    self.composerAttachmentMenu
                }
                if self.composerShowsDictationButton {
                    self.composerDictationButton
                }
                Spacer()
            }
            // The action row hides in place, so the shell above it does not move.
            .opacity(self.chatStore.dictationState == .idle ? 1 : 0)
            .disabled(self.chatStore.dictationState != .idle)
            .accessibilityHidden(self.chatStore.dictationState != .idle)
        }
    }
    #else
    /// One glass shell: a single row while the draft fits beside the controls, then the text on its own lines above
    /// a control row. The text view keeps its structural slot, so focus, selection and marked text survive the switch.
    private var composerShell: some View {
        let isExpanded = self.isComposerExpanded

        return VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                if isExpanded == false && self.composerShowsAttachmentButton {
                    self.composerAttachmentMenu
                }
                self.composerTextSlot(topContentInset: isExpanded ? aiChatComposerExpandedTextTopPadding : 0)
                    .padding(.horizontal, isExpanded ? aiChatComposerExpandedTextHorizontalPadding : aiChatComposerCompactTextHorizontalPadding)
                    .frame(maxWidth: .infinity, minHeight: isExpanded ? nil : aiChatComposerControlSize, alignment: .leading)
                    .background {
                        self.composerTextSlotFocusTarget
                    }
                if isExpanded == false {
                    if self.composerShowsDictationButton {
                        self.composerDictationButton
                    }
                    self.composerPrimaryButton
                }
            }

            if isExpanded {
                HStack(spacing: 0) {
                    if self.composerShowsAttachmentButton {
                        self.composerAttachmentMenu
                    }
                    Spacer(minLength: 0)
                    if self.composerShowsDictationButton {
                        self.composerDictationButton
                    }
                    self.composerPrimaryButton
                }
            }
        }
        .modifier(AIChatComposerDictationDraftLock(
            isLocked: self.chatStore.dictationState != .idle,
            lockedHeight: self.composerSingleRowHeight
        ))
        .overlay {
            self.composerDictationToolbar
        }
        .padding(.horizontal, aiChatComposerShellHorizontalInset)
        .padding(.vertical, aiChatComposerShellVerticalInset)
        .background {
            self.composerKeyboardObserver
        }
        .nativeTextInputBackground(cornerRadius: self.composerShellCornerRadius)
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            // A side chat off screen keeps the measurement of the one on screen.
            guard self.isCompanion == false || self.isPresentationActive else { return }
            let previousWidth = self.composerShellWidth.value
            guard abs(width - previousWidth) >= 0.5 else { return }
            self.composerShellWidth.update(
                width,
                notifiesObservers: self.isComposerExpanded(shellWidth: width)
                    != self.isComposerExpanded(shellWidth: previousWidth)
            )
        }
        // The text view must widen and move in one frame; an inherited animation would slide its caret and text.
        .transaction { transaction in
            transaction.animation = nil
        }
    }

    /// Every section's side chat shares one measurement, so a pane coming on screen lays the draft out in its final
    /// shape at once.
    var composerShellWidth: AIChatComposerShellWidth {
        self.isCompanion ? self.chatStore.companionPresentation.composerShellWidth : self.tabComposerShellWidth
    }

    /// The shell's corner radius makes the single-row shell a capsule and stays the same once the draft expands.
    private var composerShellCornerRadius: CGFloat {
        (self.composerSingleRowHeight + 2 * aiChatComposerShellVerticalInset) / 2
    }

    private var composerSingleRowHeight: CGFloat {
        max(aiChatComposerControlSize, ceil(aiChatComposerFont(dynamicTypeSize: self.dynamicTypeSize).lineHeight))
    }

    /// The draft leaves the single row once it no longer fits one line of the row's text slot. Measuring that slot
    /// from the shell width, rather than the text view, keeps the decision independent of the current layout.
    private var isComposerExpanded: Bool {
        self.isComposerExpanded(shellWidth: self.composerShellWidth.value)
    }

    private func isComposerExpanded(shellWidth: CGFloat) -> Bool {
        // A draft over 256 characters always takes the full width, so only shorter drafts are measured and a long
        // draft costs the same as a short one.
        let text = self.chatStore.inputText.prefix(257)
        guard text.isEmpty == false else { return false }
        if text.count > 256 || text.contains(where: \.isNewline) {
            return true
        }
        guard shellWidth > 0 else { return false }
        let controlCount = 1
            + (self.composerShowsAttachmentButton ? 1 : 0)
            + (self.composerShowsDictationButton ? 1 : 0)
        let compactTextWidth = shellWidth
            - 2 * aiChatComposerShellHorizontalInset
            - CGFloat(controlCount) * aiChatComposerControlSize
            - 2 * aiChatComposerCompactTextHorizontalPadding
            - aiChatComposerExpansionMargin
        return aiChatComposerSingleLineWidth(text: String(text), dynamicTypeSize: self.dynamicTypeSize) > compactTextWidth
    }
    #endif

    /// `topContentInset` applies on iOS only; the Mac composer keeps its outer padding.
    private func composerTextSlot(topContentInset: CGFloat) -> some View {
        self.composerTextView(topContentInset: topContentInset)
            .modifier(ComposerKeyboardModifier(
                isEnabled: self.isPresentationActive,
                onDismiss: self.dismissComposerFocus
            ))
    }

    /// Behind the text view, so its padding focuses it and taps on the text stay with UIKit selection gestures.
    private var composerTextSlotFocusTarget: some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture {
                self.isComposerFocused = true
            }
    }

    private var composerKeyboardObserver: some View {
        #if targetEnvironment(macCatalyst)
        AIChatComposerKeyboardObserver(
            isEnabled: self.isPresentationActive,
            canSend: { self.chatStore.canSendMessage },
            onSend: self.sendComposerMessageFromReturnKey,
            macReturnKeyOwner: self.macComposerReturnKeyOwner
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        #else
        AIChatComposerKeyboardObserver(
            isEnabled: self.isPresentationActive,
            canSend: { self.chatStore.canSendMessage },
            onSend: self.sendComposerMessageFromReturnKey
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        #endif
    }

    private var composerShowsAttachmentButton: Bool {
        self.chatStore.serverChatConfig.features.attachmentsEnabled
    }

    private var composerShowsDictationButton: Bool {
        self.chatStore.serverChatConfig.features.dictationEnabled || self.chatStore.dictationState != .idle
    }

    private var composerPrimaryButton: some View {
        Button {
            self.handlePrimaryComposerAction()
        } label: {
            Group {
                if self.chatStore.bootstrapPhase == .loading
                    || self.chatStore.composerPhase == .preparingSend {
                    ProgressView()
                        .controlSize(.small)
                        .frame(
                            width: aiChatComposerSendButtonVisualSize,
                            height: aiChatComposerSendButtonVisualSize
                        )
                } else {
                    Image(systemName: self.chatStore.canStopResponse ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .frame(
                            width: aiChatComposerSendButtonVisualSize,
                            height: aiChatComposerSendButtonVisualSize
                        )
                        .foregroundStyle(self.chatStore.canStopResponse ? AnyShapeStyle(Color.red) : AnyShapeStyle(.tint))
                }
            }
            #if targetEnvironment(macCatalyst)
            .padding(.trailing, aiChatComposerSendButtonInset)
            .padding(.bottom, aiChatComposerSendButtonInset)
            .frame(
                width: aiChatComposerSendButtonHitSize,
                height: aiChatComposerSendButtonHitSize,
                alignment: .bottomTrailing
            )
            #else
            .frame(width: aiChatComposerControlSize, height: aiChatComposerControlSize)
            #endif
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(self.primaryComposerButtonDisabled)
        .accessibilityLabel(self.primaryComposerButtonAccessibilityLabel)
        .accessibilityIdentifier(UITestIdentifier.aiComposerSendButton)
    }

    private var composerAttachmentMenu: some View {
        Menu {
            ForEach(aiChatAttachmentMenuActions()) { action in
                Button {
                    self.handleAttachmentMenuAction(action)
                } label: {
                    Label(localizedAIAttachmentMenuActionTitle(action), systemImage: action.systemImage)
                }
            }
        } label: {
            aiChatComposerAccessoryIcon(systemName: "paperclip")
        }
        #if targetEnvironment(macCatalyst)
        .nativeActionButtonStyle()
        #else
        .menuStyle(.button)
        .nativeInlineActionButtonStyle()
        #endif
        .tint(.accentColor)
        .disabled(self.chatStore.canAttachToDraft == false)
        .accessibilityIdentifier(UITestIdentifier.aiComposerAttachmentButton)
        .accessibilityLabel(aiSettingsLocalized("ai.composer.addAttachment", "Add attachment"))
        .accessibilityHint(
            aiSettingsLocalized(
                "ai.composer.addAttachment.hint",
                "Take a photo, choose a photo, or select a file"
            )
        )
        .menuOrder(.fixed)
    }

    private var composerDictationButton: some View {
        Button {
            self.startComposerDictation()
        } label: {
            aiChatComposerAccessoryIcon(systemName: "mic")
        }
        #if targetEnvironment(macCatalyst)
        .nativeActionButtonStyle()
        #else
        .nativeInlineActionButtonStyle()
        #endif
        .tint(.accentColor)
        .disabled(self.chatStore.canStartDictation == false)
        .accessibilityIdentifier(UITestIdentifier.aiComposerDictationButton)
        .accessibilityLabel(aiSettingsLocalized("ai.composer.dictation.start", "Start dictation"))
    }

    private func composerTextView(topContentInset: CGFloat) -> AIChatComposerTextView {
        let placeholder = aiSettingsLocalized(
            "ai.composer.placeholder",
            "Ask about cards, review history, or propose a change..."
        )
        #if targetEnvironment(macCatalyst)
        return AIChatComposerTextView(
            text: self.composerTextBinding,
            selection: self.composerSelectionBinding,
            isFocused: self.$isComposerFocused,
            isAttachmentDropHovering: self.$isComposerDropHovering,
            placeholder: placeholder,
            isDisabled: self.composerTextFieldDisabled,
            canAttachToDraft: self.chatStore.canAttachToDraft,
            maximumLineCount: aiChatComposerMaximumLineCount,
            onAttachmentItemProviders: self.attachItemProviders,
            takesKeyboardOnArrival: self.takesComposerKeyboardOnArrival(windowScene:),
            onWindowSceneChange: { [composerWindowScene = self.composerWindowScene] scene in
                composerWindowScene.scene = scene
            },
            macReturnKeyOwner: self.macComposerReturnKeyOwner
        )
        #else
        return AIChatComposerTextView(
            text: self.composerTextBinding,
            selection: self.composerSelectionBinding,
            isFocused: self.$isComposerFocused,
            isAttachmentDropHovering: self.$isComposerDropHovering,
            placeholder: placeholder,
            isDisabled: self.composerTextFieldDisabled,
            canAttachToDraft: self.chatStore.canAttachToDraft,
            maximumLineCount: aiChatComposerMaximumLineCount,
            topContentInset: topContentInset,
            onAttachmentItemProviders: self.attachItemProviders,
            takesKeyboardOnArrival: self.takesComposerKeyboardOnArrival(windowScene:),
            onWindowSceneChange: { [composerWindowScene = self.composerWindowScene] scene in
                composerWindowScene.scene = scene
            }
        )
        #endif
    }

    /// Hidden while the person's own key is active, because messages on that key have no monthly limit.
    var remainingMessagesNotice: String? {
        guard self.flashcardsStore.isOwnOpenAIKeyActive == false,
              let usage = self.flashcardsStore.currentAIMonthlyUsage,
              usage.monthEndsAt > Date() else {
            return nil
        }

        return aiChatRemainingMessagesNotice(usage: usage)
    }

    private func composerAttachmentAccessibilityValue(_ attachment: AIChatAttachment) -> String {
        switch attachment.payload {
        case .localFile(let fileName, _, _):
            return fileName
        case .card(let card):
            return aiChatCardAttachmentLabel(card: card)
        case .unknown(let unknownAttachment):
            return aiSettingsLocalizedFormat(
                "ai.composer.attachment.unsupported",
                "Unsupported attachment (%@)",
                unknownAttachment.originalType
            )
        }
    }

    var primaryComposerButtonDisabled: Bool {
        self.chatStore.canStopResponse == false && self.chatStore.canSendMessage == false
    }

    var primaryComposerButtonAccessibilityLabel: String {
        guard self.chatStore.bootstrapPhase != .loading else {
            return aiSettingsLocalized("ai.loading.title", "Loading chat")
        }

        return self.chatStore.canStopResponse
            ? aiSettingsLocalized("ai.composer.stopResponse", "Stop response")
            : aiSettingsLocalized("ai.composer.sendMessage", "Send message")
    }

    var composerTextFieldDisabled: Bool {
        self.chatStore.canEditDraftText == false
    }
}
