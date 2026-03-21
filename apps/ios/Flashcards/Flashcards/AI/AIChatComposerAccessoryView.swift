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
                                    Image(systemName: attachment.isImage ? "photo" : "doc")
                                        .foregroundStyle(.secondary)
                                    Text(attachment.fileName)
                                        .font(.caption)
                                        .lineLimit(1)
                                    Button {
                                        self.chatStore.removeAttachment(id: attachment.id)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(.thinMaterial, in: Capsule())
                            }
                        }
                    }
                }

                ZStack(alignment: .bottomTrailing) {
                    TextField(
                        "Ask about cards, review history, or propose a change...",
                        text: $chatStore.inputText,
                        selection: self.$composerSelection,
                        axis: .vertical
                    )
                    .focused(self.$isComposerFocused)
                    .lineLimit(1...aiChatComposerMaximumLineCount)
                    .padding(.leading, 12)
                    .padding(.top, self.chatStore.dictationState == .idle ? 12 : aiChatComposerDictationTextFieldTopPadding)
                    .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    .padding(.bottom, 12)

                    Button {
                        self.handlePrimaryComposerAction()
                    } label: {
                        Image(systemName: self.chatStore.isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .frame(width: aiChatComposerSendButtonVisualSize, height: aiChatComposerSendButtonVisualSize)
                            .foregroundStyle(self.chatStore.isStreaming ? Color.red : Color.accentColor)
                    }
                    .buttonStyle(.plain)
                    .disabled(self.primaryComposerButtonDisabled)
                    .accessibilityLabel(self.chatStore.isStreaming ? "Stop response" : "Send message")
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
                        Menu {
                            ForEach(aiChatAttachmentMenuActions()) { action in
                                Button {
                                    self.handleAttachmentMenuAction(action)
                                } label: {
                                    Label(action.title, systemImage: action.systemImage)
                                }
                            }
                        } label: {
                            aiChatComposerAccessoryIcon(systemName: "paperclip")
                        }
                        .buttonStyle(.glass)
                        .tint(.accentColor)
                        .disabled(self.chatStore.dictationState != .idle)
                        .accessibilityLabel("Add attachment")
                        .accessibilityHint("Take a photo, choose a photo, or select a file")
                        .menuOrder(.fixed)

                        Button {
                            self.handleDictationButtonTap()
                        } label: {
                            aiChatComposerAccessoryIcon(
                                systemName: self.chatStore.dictationState == .recording ? "stop.fill" : "mic"
                            )
                        }
                        .buttonStyle(.glass)
                        .tint(self.chatStore.dictationState == .recording ? .red : .accentColor)
                        .disabled(self.chatStore.dictationState == .requestingPermission || self.chatStore.dictationState == .transcribing)
                        .accessibilityLabel(self.chatStore.dictationState == .recording ? "Stop dictation" : "Start dictation")
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
            return "Waiting for microphone access..."
        case .recording:
            return "Listening..."
        case .transcribing:
            return "Transcribing..."
        }
    }

    @ViewBuilder
    var composerModelControl: some View {
        if self.chatStore.isModelLocked || self.chatStore.dictationState != .idle {
            Text("Model: \(self.selectedModelLabel)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            Picker(
                "Model",
                selection: Binding(
                    get: {
                        self.chatStore.selectedModelId
                    },
                    set: { nextModelId in
                        self.chatStore.setSelectedModel(modelId: nextModelId)
                    }
                )
            ) {
                ForEach(self.chatStore.availableModels) { model in
                    Text(model.label).tag(model.id)
                }
            }
            .pickerStyle(.menu)
        }
    }

    var selectedModelLabel: String {
        (self.chatStore.availableModels + AIChatModelDef.all).first(where: { model in
            model.id == self.chatStore.selectedModelId
        })?.label ?? self.chatStore.selectedModelId
    }

    var primaryComposerButtonDisabled: Bool {
        self.chatStore.isStreaming == false && self.chatStore.canSendMessage == false
    }
}
