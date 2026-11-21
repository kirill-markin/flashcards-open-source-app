import SwiftUI

enum AIChatHistoryReaderPhase: Equatable {
    case loading
    case failed(message: String)
    case unavailable
    case loaded(messages: [AIChatMessage])
}

/// Every section showing the same pushed reader shares its load.
@MainActor
@Observable
final class AIChatHistoryReaderModel {
    private(set) var phase: AIChatHistoryReaderPhase

    @ObservationIgnored private let chatStore: AIChatStore
    @ObservationIgnored private let sessionId: String
    @ObservationIgnored private let onUnavailable: () -> Void
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    init(chatStore: AIChatStore, sessionId: String, onUnavailable: @escaping () -> Void) {
        self.phase = .loading
        self.chatStore = chatStore
        self.sessionId = sessionId
        self.onUnavailable = onUnavailable
        self.loadTask = nil
    }

    /// Only a load that never finished runs again. The load outlives the page that started it, so the next section's
    /// side chat shows its result instead of starting over.
    func loadIfNeeded() {
        guard self.phase == .loading, self.loadTask == nil else {
            return
        }
        self.loadTask = Task {
            await self.load()
            self.loadTask = nil
        }
    }

    func retry() {
        self.phase = .loading
        self.loadIfNeeded()
    }

    private func load() async {
        do {
            let session = try await self.chatStore.flashcardsStore.cloudSessionForAI()
            let snapshot = try await self.chatStore.chatService.loadSnapshot(
                session: session,
                sessionId: self.sessionId
            )
            self.phase = .loaded(messages: snapshot.conversation.messages)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }
            if isAIChatSessionUnavailableError(error: error) {
                self.phase = .unavailable
                self.onUnavailable()
                return
            }
            captureAIChatHistoryFailure(
                error: error,
                flashcardsStore: self.chatStore.flashcardsStore,
                action: "chat_history_read",
                sessionId: self.sessionId
            )
            self.phase = .failed(message: errorMessage(error: error))
        }
    }
}

/// Shows an old chat without a composer; the server refuses to continue a chat that is not current.
struct AIChatHistoryReaderView: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.aiCompanionPaneSharesSectionBar) private var sharesSectionBar
    let chatStore: AIChatStore
    let summary: AIChatSessionHistorySummary
    @State private var model: AIChatHistoryReaderModel

    init(chatStore: AIChatStore, summary: AIChatSessionHistorySummary, model: AIChatHistoryReaderModel) {
        self.chatStore = chatStore
        self.summary = summary
        self._model = State(initialValue: model)
    }

    var body: some View {
        self.content
            .aiCompanionPageTitle(self.summary.title ?? aiChatHistoryUntitledChatTitle(), sharesSectionBar: self.sharesSectionBar) {
                EmptyView()
            }
            #if targetEnvironment(macCatalyst)
            .macToolbarContribution(MacToolbarContribution(tab: .ai, role: .navigation))
            #endif
            .nativeBottomBar(alignment: .center) {
                Text(aiSettingsLocalized("ai.history.readOnlyNotice", "Read-only: old chats can't be continued."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, aiChatMessageListHorizontalPadding)
                    .padding(.vertical, 12)
            }
            .onAppear {
                self.model.loadIfNeeded()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch self.model.phase {
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
                    self.model.retry()
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
                    isRunActive: false,
                    repairStatus: nil,
                    showsTypingIndicator: false,
                    disclosures: self.chatStore.transcriptDisclosures[message.id] ?? [:],
                    onSetDisclosure: { [chatStore = self.chatStore, messageId = message.id] key, isExpanded in
                        chatStore.setTranscriptDisclosure(messageId: messageId, key: key, isExpanded: isExpanded)
                    },
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
}
