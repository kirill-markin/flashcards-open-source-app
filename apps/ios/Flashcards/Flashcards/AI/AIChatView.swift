import SwiftUI

struct AIChatView: View {
    @ObservedObject private var flashcardsStore: FlashcardsStore
    @StateObject private var chatStore: AIChatStore
    @State private var isCloudSignInPresented: Bool
    @FocusState private var isComposerFocused: Bool

    init(flashcardsStore: FlashcardsStore) {
        self.flashcardsStore = flashcardsStore
        self.isCloudSignInPresented = false

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let historyStore = AIChatHistoryStore(
            userDefaults: UserDefaults.standard,
            encoder: encoder,
            decoder: decoder
        )
        let chatService = AIChatService(
            session: URLSession.shared,
            encoder: encoder,
            decoder: decoder
        )
        let toolExecutor = LocalAIToolExecutor(
            flashcardsStore: flashcardsStore,
            encoder: encoder,
            decoder: decoder
        )
        _chatStore = StateObject(
            wrappedValue: AIChatStore(
                flashcardsStore: flashcardsStore,
                historyStore: historyStore,
                chatService: chatService,
                toolExecutor: toolExecutor
            )
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if chatStore.errorMessage.isEmpty == false {
                Text(chatStore.errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }

            if flashcardsStore.cloudSettings?.cloudState == .linked {
                self.chatContent
            } else {
                self.signInGate
            }
        }
        .navigationTitle("AI")
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(flashcardsStore)
        }
    }

    private var signInGate: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Sign in to use AI. It can help you explore your cards, spot weak areas, and draft changes before you save them.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 24)
            Button("Sign in for AI chat") {
                self.isCloudSignInPresented = true
            }
            .buttonStyle(.borderedProminent)
            Spacer()
        }
    }

    private var chatContent: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Local workspace AI")
                    .font(.headline)
                Spacer()
                Button("Clear") {
                    chatStore.clearHistory()
                }
                .disabled(chatStore.messages.isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .onTapGesture {
                self.isComposerFocused = false
            }

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if chatStore.messages.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Try asking")
                                    .font(.headline)
                                Text("Summarize weak areas from my due cards.")
                                Text("Find cards tagged with grammar and suggest cleanup.")
                                Text("Propose a new deck filter, then wait for confirmation before changing it.")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .foregroundStyle(.secondary)
                        }

                        ForEach(chatStore.messages) { message in
                            self.messageRow(
                                message: message,
                                repairStatus: self.repairStatus(for: message)
                            )
                                .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .background(Color(.systemGroupedBackground))
                .contentShape(Rectangle())
                .onTapGesture {
                    self.isComposerFocused = false
                }
                .onChange(of: chatStore.messages) { _, messages in
                    guard let lastMessage = messages.last else {
                        return
                    }

                    withAnimation {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 12) {
                if chatStore.isModelLocked {
                    Text("Model: \(self.selectedModelLabel)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Picker(
                        "Model",
                        selection: Binding(
                            get: {
                                chatStore.selectedModelId
                            },
                            set: { nextModelId in
                                chatStore.setSelectedModel(modelId: nextModelId)
                            }
                        )
                    ) {
                        ForEach(AIChatModelDef.all) { model in
                            Text(model.label).tag(model.id)
                        }
                    }
                    .pickerStyle(.menu)
                }

                ZStack(alignment: .topLeading) {
                    TextEditor(text: self.$chatStore.inputText)
                        .focused(self.$isComposerFocused)
                        .frame(minHeight: 88, maxHeight: 140)
                        .padding(4)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(.separator), lineWidth: 1)
                        )

                    if chatStore.inputText.isEmpty {
                        Text("Ask about cards, review history, or propose a change...")
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 14)
                    }
                }

                HStack {
                    if chatStore.isStreaming {
                        Button("Cancel") {
                            chatStore.cancelStreaming()
                        }
                        .buttonStyle(.bordered)
                    }

                    Spacer()

                    Button("Send") {
                        chatStore.sendMessage()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(chatStore.canSendMessage == false)
                }
            }
            .padding(16)
        }
    }

    private var selectedModelLabel: String {
        AIChatModelDef.all.first(where: { model in
            model.id == chatStore.selectedModelId
        })?.label ?? chatStore.selectedModelId
    }

    private func repairStatus(for message: AIChatMessage) -> AIChatRepairAttemptStatus? {
        guard message.role == .assistant else {
            return nil
        }

        guard chatStore.messages.last?.id == message.id else {
            return nil
        }

        return chatStore.repairStatus
    }

    private func messageRow(message: AIChatMessage, repairStatus: AIChatRepairAttemptStatus?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.role == .user ? "You" : "Assistant")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if message.text.isEmpty == false {
                Text(message.text)
                    .textSelection(.enabled)
            }

            if let repairStatus {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(repairStatus.displayText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(message.toolCalls) { toolCall in
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(toolCall.input)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)

                        if let output = toolCall.output {
                            Divider()
                            Text(output)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                } label: {
                    HStack {
                        Text(toolCall.name.replacingOccurrences(of: "_", with: " ").capitalized)
                        Spacer()
                        Text(toolCall.status == .requested ? "Running" : "Done")
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(message.role == .user ? Color.accentColor.opacity(0.12) : Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(message.isError ? Color.red.opacity(0.5) : Color.clear, lineWidth: 1)
        )
    }
}
