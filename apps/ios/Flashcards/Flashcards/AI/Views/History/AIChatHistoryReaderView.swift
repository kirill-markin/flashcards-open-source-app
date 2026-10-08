import SwiftUI

enum AIChatHistoryReaderPhase: Equatable {
    case loading
    case failed(message: String)
    case unavailable
    case loaded(messages: [AIChatMessage])
}

/// Shows an old chat without a composer; the server refuses to continue a chat that is not current.
struct AIChatHistoryReaderView: View {
    @Environment(FlashcardsStore.self) private var flashcardsStore: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    let chatStore: AIChatStore
    let summary: AIChatSessionHistorySummary
    let onUnavailable: (String) -> Void
    @State private var phase: AIChatHistoryReaderPhase

    @MainActor
    init(
        chatStore: AIChatStore,
        summary: AIChatSessionHistorySummary,
        onUnavailable: @escaping (String) -> Void
    ) {
        self.chatStore = chatStore
        self.summary = summary
        self.onUnavailable = onUnavailable
        self._phase = State(initialValue: .loading)
    }

    var body: some View {
        self.content
            .navigationTitle(self.summary.title ?? aiChatHistoryUntitledChatTitle())
            .navigationBarTitleDisplayMode(.inline)
            .nativeBottomBar(alignment: .center) {
                Text(aiSettingsLocalized("ai.history.readOnlyNotice", "Read-only: old chats can't be continued."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, aiChatMessageListHorizontalPadding)
                    .padding(.vertical, 12)
            }
            .task {
                await self.loadIfNeeded()
            }
            .onChange(of: aiChatHistoryScope(flashcardsStore: self.flashcardsStore)) { _, _ in
                self.navigation.popAIToLiveChat()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch self.phase {
        case .loading:
            ProgressView(aiSettingsLocalized("ai.history.readerLoading", "Loading chat..."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label(
                    aiSettingsLocalized("ai.history.readerLoadError", "Couldn't load this chat."),
                    systemImage: "exclamationmark.triangle"
                )
            } description: {
                Text(message)
                    .textSelection(.enabled)
            } actions: {
                Button(aiSettingsLocalized("common.retry", "Retry")) {
                    self.phase = .loading
                    Task {
                        await self.loadIfNeeded()
                    }
                }
                .nativeProminentActionButtonStyle()
            }
        case .unavailable:
            ContentUnavailableView {
                Label(
                    aiSettingsLocalized("ai.history.unavailable", "This chat is no longer available."),
                    systemImage: "archivebox"
                )
            }
        case .loaded(let messages):
            self.transcript(messages: messages)
        }
    }

    private func transcript(messages: [AIChatMessage]) -> some View {
        List {
            ForEach(messages) { message in
                AIChatMessageRow(
                    message: message,
                    repairStatus: nil,
                    showsTypingIndicator: false,
                    onExpandContent: {},
                    onOpenAccountStatus: {
                        self.navigation.openSettings(destination: .accountStatus)
                    }
                )
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .listRowSpacing(12)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .contentMargins(.horizontal, aiChatMessageListHorizontalPadding, for: .scrollContent)
        .contentMargins(.vertical, 12, for: .scrollContent)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .accessibilityIdentifier(UITestIdentifier.aiHistoryReader)
    }

    /// Only a load that never finished runs again, so returning to this screen keeps the transcript.
    private func loadIfNeeded() async {
        guard self.phase == .loading else {
            return
        }

        do {
            let session = try await self.chatStore.flashcardsStore.cloudSessionForAI()
            let snapshot = try await self.chatStore.chatService.loadSnapshot(
                session: session,
                sessionId: self.summary.sessionId
            )
            self.phase = .loaded(messages: snapshot.conversation.messages)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }
            if isAIChatSessionUnavailableError(error: error) {
                self.phase = .unavailable
                self.onUnavailable(self.summary.sessionId)
                return
            }
            self.phase = .failed(message: errorMessage(error: error))
        }
    }
}
