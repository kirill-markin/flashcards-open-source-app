import SwiftUI

struct AIChatDictationStatusLane: View {
    let statusText: String

    var body: some View {
        TimelineView(.animation(minimumInterval: aiChatTypingIndicatorAnimationStepSeconds)) { context in
            let activeDotCount = aiChatTypingIndicatorActiveDotCount(date: context.date)

            HStack(spacing: 10) {
                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(0..<5, id: \.self) { index in
                        Capsule()
                            .fill(Color.accentColor.opacity(index < activeDotCount + 1 ? 0.95 : 0.35))
                            .frame(width: 6, height: index < activeDotCount + 1 ? 18 : 10)
                    }
                }
                Text(self.statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(
                maxWidth: .infinity,
                minHeight: aiChatComposerStatusLaneHeight,
                alignment: .leading
            )
        }
    }
}

func aiChatComposerAccessoryIcon(systemName: String) -> some View {
    Image(systemName: systemName)
        .font(.system(size: 15, weight: .medium))
        .frame(width: 16, height: 16)
}

extension AIChatView {
    var composerAccessory: some View {
        @Bindable var chatStore = self.chatStore

        return ReadableContentLayout(
            maxWidth: flashcardsReadableContentMaxWidth,
            horizontalPadding: 16
        ) {
            VStack(alignment: .leading, spacing: 12) {
                if self.chatStore.pendingAttachments.isEmpty == false {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(self.chatStore.pendingAttachments) { attachment in
                                HStack(spacing: 6) {
                                    switch attachment.payload {
                                    case .binary(let fileName, _, _):
                                        Image(systemName: attachment.isImage ? "photo" : "doc")
                                            .foregroundStyle(.secondary)
                                        Text(fileName)
                                            .font(.caption)
                                            .lineLimit(1)
                                    case .card(let card):
                                        Image(systemName: "square.stack")
                                            .foregroundStyle(.secondary)
                                        Text(aiChatCardAttachmentLabel(card: card))
                                            .font(.caption)
                                            .lineLimit(1)
                                            .accessibilityIdentifier(UITestIdentifier.aiComposerCardAttachmentChip)
                                    case .unknown(let unknownAttachment):
                                        Image(systemName: "questionmark.square.dashed")
                                            .foregroundStyle(.secondary)
                                        Text(
                                            aiSettingsLocalizedFormat(
                                                "ai.composer.attachment.unsupported",
                                                "Unsupported attachment (%@)",
                                                unknownAttachment.originalType
                                            )
                                        )
                                            .font(.caption)
                                            .lineLimit(1)
                                    }
                                    Button {
                                        self.chatStore.removeAttachment(id: attachment.id)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(self.chatStore.canModifyDraftAttachments == false)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(.thinMaterial, in: Capsule())
                            }
                        }
                    }
                }

                if self.chatStore.visibleComposerSuggestions.isEmpty == false {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(self.chatStore.visibleComposerSuggestions.enumerated()), id: \.element.id) { index, suggestion in
                                Button {
                                    self.chatStore.applyComposerSuggestion(suggestion)
                                    self.isComposerFocused = true
                                } label: {
                                    Text(suggestion.text)
                                        .font(.footnote)
                                        .foregroundStyle(.primary)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 9)
                                }
                                .buttonStyle(.plain)
                                .background(.thinMaterial, in: Capsule())
                                .overlay {
                                    Capsule()
                                        .strokeBorder(Color.accentColor.opacity(0.18), lineWidth: 1)
                                }
                                .accessibilityIdentifier("\(UITestIdentifier.aiComposerSuggestionPrefix)\(index)")
                            }
                        }
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiComposerSuggestionRow)
                }

                ZStack(alignment: .bottomTrailing) {
                    TextField(
                        aiSettingsLocalized(
                            "ai.composer.placeholder",
                            "Ask about cards, review history, or propose a change..."
                        ),
                        text: $chatStore.inputText,
                        selection: self.$composerSelection,
                        axis: .vertical
                    )
                    .disabled(self.composerTextFieldDisabled)
                    .autocorrectionDisabled(true)
                    .focused(self.$isComposerFocused)
                    .onTapGesture {
                        self.isComposerFocused = true
                    }
                    .lineLimit(1...aiChatComposerMaximumLineCount)
                    .padding(.leading, 12)
                    .padding(.top, self.chatStore.dictationState == .idle ? 12 : aiChatComposerDictationTextFieldTopPadding)
                    .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    .padding(.bottom, 12)
                    .accessibilityIdentifier(UITestIdentifier.aiComposerTextField)

                    Button {
                        self.handlePrimaryComposerAction()
                    } label: {
                        Image(systemName: self.chatStore.canStopResponse ? "stop.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .frame(width: aiChatComposerSendButtonVisualSize, height: aiChatComposerSendButtonVisualSize)
                            .foregroundStyle(self.chatStore.canStopResponse ? Color.red : Color.accentColor)
                    }
                    .buttonStyle(.plain)
                    .disabled(self.primaryComposerButtonDisabled)
                    .accessibilityLabel(
                        self.chatStore.canStopResponse
                            ? aiSettingsLocalized("ai.composer.stopResponse", "Stop response")
                            : aiSettingsLocalized("ai.composer.sendMessage", "Send message")
                    )
                    .accessibilityIdentifier(UITestIdentifier.aiComposerSendButton)
                    .padding(.trailing, aiChatComposerSendButtonInset)
                    .padding(.bottom, aiChatComposerSendButtonInset)
                }
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if self.chatStore.dictationState != .idle {
                        AIChatDictationStatusLane(statusText: self.dictationStatusText)
                            .padding(.top, 12)
                            .padding(.leading, 12)
                            .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .simultaneousGesture(
                    TapGesture().onEnded {
                        self.isComposerFocused = true
                    }
                )

                HStack {
                    self.composerModelControl
                    Spacer()

                    HStack(spacing: 8) {
                        if self.chatStore.serverChatConfig.features.attachmentsEnabled {
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
                            .buttonStyle(.glass)
                            .tint(.accentColor)
                            .disabled(self.chatStore.canAttachToDraft == false)
                            .accessibilityLabel(aiSettingsLocalized("ai.composer.addAttachment", "Add attachment"))
                            .accessibilityHint(
                                aiSettingsLocalized(
                                    "ai.composer.addAttachment.hint",
                                    "Take a photo, choose a photo, or select a file"
                                )
                            )
                            .menuOrder(.fixed)
                        }

                        if self.chatStore.serverChatConfig.features.dictationEnabled || self.chatStore.dictationState != .idle {
                            Button {
                                self.handleDictationButtonTap()
                            } label: {
                                aiChatComposerAccessoryIcon(
                                    systemName: self.chatStore.dictationState == .recording ? "stop.fill" : "mic"
                                )
                            }
                            .buttonStyle(.glass)
                            .tint(self.chatStore.dictationState == .recording ? .red : .accentColor)
                            .disabled(self.chatStore.canUseDictation == false)
                            .accessibilityLabel(
                                self.chatStore.dictationState == .recording
                                    ? aiSettingsLocalized("ai.composer.dictation.stop", "Stop dictation")
                                    : aiSettingsLocalized("ai.composer.dictation.start", "Start dictation")
                            )
                        }
                    }
                }
            }
            .padding(.top, aiChatComposerTopPadding)
            .padding(.bottom, 16)
        }
    }

    var dictationStatusText: String {
        switch self.chatStore.dictationState {
        case .idle:
            return ""
        case .requestingPermission:
            return aiSettingsLocalized("ai.composer.dictation.waiting", "Waiting for microphone access...")
        case .recording:
            return aiSettingsLocalized("ai.composer.dictation.listening", "Listening...")
        case .transcribing:
            return aiSettingsLocalized("ai.composer.dictation.transcribing", "Transcribing...")
        }
    }

    @ViewBuilder
    var composerModelControl: some View {
        Text("\(self.chatStore.serverChatConfig.provider.label) · \(self.chatStore.serverChatConfig.model.badgeLabel)")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    var primaryComposerButtonDisabled: Bool {
        self.chatStore.canStopResponse == false && self.chatStore.canSendMessage == false
    }

    var composerTextFieldDisabled: Bool {
        self.chatStore.canEditDraft == false
    }
}
