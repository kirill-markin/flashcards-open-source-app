import SwiftUI

func aiChatHistoryUntitledChatTitle() -> String {
    aiSettingsLocalized("ai.history.untitledChat", "Untitled chat")
}

/// History rows and requests belong to one account and workspace, so a change there closes the history screens.
@MainActor
func aiChatHistoryScope(flashcardsStore: FlashcardsStore) -> [String?] {
    [
        flashcardsStore.workspace?.workspaceId,
        flashcardsStore.cloudSettings?.activeWorkspaceId,
        flashcardsStore.cloudSettings?.linkedUserId
    ]
}

struct AIChatHistoryView: View {
    @Environment(FlashcardsStore.self) private var flashcardsStore: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    let chatStore: AIChatStore
    @State private var model: AIChatHistoryListModel
    @State private var renameTarget: AIChatSessionHistorySummary?
    @State private var renameDraft: String
    @State private var archiveTarget: AIChatSessionHistorySummary?

    @MainActor
    init(chatStore: AIChatStore) {
        self.chatStore = chatStore
        self._model = State(initialValue: AIChatHistoryListModel(chatStore: chatStore))
        self._renameTarget = State(initialValue: nil)
        self._renameDraft = State(initialValue: "")
        self._archiveTarget = State(initialValue: nil)
    }

    var body: some View {
        self.content
            .navigationTitle(aiSettingsLocalized("ai.history.title", "Chat history"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: self.$model.searchQuery,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: aiSettingsLocalized("ai.history.searchPlaceholder", "Search chats")
            )
            .task(id: self.model.searchQuery) {
                await self.model.handleSearchQueryChange()
            }
            .onChange(of: self.model.searchQuery) { _, query in
                let limitedQuery = aiChatHistoryLimitedText(
                    text: query,
                    maximumLength: aiChatSessionHistorySearchMaximumLength
                )
                if limitedQuery != query {
                    self.model.searchQuery = limitedQuery
                }
            }
            .onChange(of: self.renameDraft) { _, draft in
                let limitedDraft = aiChatHistoryLimitedText(
                    text: draft,
                    maximumLength: aiChatSessionTitleMaximumLength
                )
                if limitedDraft != draft {
                    self.renameDraft = limitedDraft
                }
            }
            .onChange(of: aiChatHistoryScope(flashcardsStore: self.flashcardsStore)) { _, _ in
                self.navigation.popAIToLiveChat()
            }
            .navigationDestination(for: AIChatHistoryReaderRoute.self) { route in
                AIChatHistoryReaderView(
                    chatStore: self.chatStore,
                    summary: route.summary,
                    onUnavailable: { sessionId in
                        self.model.removeUnavailableSession(sessionId: sessionId)
                    }
                )
            }
            .alert(
                aiSettingsLocalized("ai.history.rename", "Rename"),
                isPresented: self.isRenamePresentedBinding,
                presenting: self.renameTarget
            ) { summary in
                TextField(aiChatHistoryUntitledChatTitle(), text: self.$renameDraft)
                Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {
                    self.renameTarget = nil
                }
                Button(aiSettingsLocalized("ai.history.save", "Save")) {
                    let title = self.renameDraft
                    self.renameTarget = nil
                    Task {
                        await self.model.rename(summary: summary, title: title)
                    }
                }
                .disabled(self.renameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .confirmationDialog(
                aiSettingsLocalized("ai.history.archiveConfirm.title", "Archive this chat?"),
                isPresented: self.isArchivePresentedBinding,
                titleVisibility: .visible,
                presenting: self.archiveTarget
            ) { summary in
                Button(aiSettingsLocalized("ai.history.archive", "Archive"), role: .destructive) {
                    self.archiveTarget = nil
                    self.archive(summary: summary)
                }
                Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {
                    self.archiveTarget = nil
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch self.model.phase {
        case .loading:
            ProgressView(aiSettingsLocalized("ai.history.loading", "Loading chats..."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label(
                    aiSettingsLocalized("ai.history.loadError", "Couldn't load chat history."),
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
        case .loaded:
            self.sessionList
        }
    }

    private var sessionList: some View {
        List {
            if let notice = self.model.notice {
                Text(notice)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            ForEach(
                aiChatHistoryCurrentChatFirst(
                    sessions: self.model.sessions,
                    currentSessionId: self.currentSessionId
                )
            ) { summary in
                self.sessionRow(summary: summary)
            }

            if self.model.nextCursor != nil {
                self.loadMoreRow
            }
        }
        .listStyle(.plain)
        .overlay {
            // Archiving every loaded row empties the list while older pages remain behind the cursor.
            if self.model.sessions.isEmpty && self.model.nextCursor == nil {
                self.emptyState
            }
        }
        .refreshable {
            await self.model.refresh()
        }
        .accessibilityIdentifier(UITestIdentifier.aiHistoryList)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            if self.model.appliedSearchText == nil {
                Label(
                    aiSettingsLocalized("ai.history.empty", "No chats yet. Your chats will appear here."),
                    systemImage: "bubble.left.and.bubble.right"
                )
            } else {
                Label(
                    aiSettingsLocalized("ai.history.noSearchResults", "No chats match your search."),
                    systemImage: "magnifyingglass"
                )
            }
        }
    }

    @ViewBuilder
    private var loadMoreRow: some View {
        switch self.model.loadMorePhase {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity)
                .listRowSeparator(.hidden)
                // A new cursor is a new row, so the next page loads even when this row never left the screen.
                .id(self.model.nextCursor)
                .onAppear {
                    self.model.loadNextPage()
                }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 8) {
                Text(aiSettingsLocalized("ai.history.loadError", "Couldn't load chat history."))
                    .foregroundStyle(.red)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button(aiSettingsLocalized("common.retry", "Retry")) {
                    self.model.loadNextPage()
                }
            }
        }
    }

    @ViewBuilder
    private func sessionRow(summary: AIChatSessionHistorySummary) -> some View {
        let isCurrent = summary.sessionId == self.currentSessionId
        let rowAction = self.model.rowActions[summary.sessionId]
        let isArchiveDisabled = rowAction != nil || (isCurrent && self.isCurrentChatArchiveDisabled)
        let rowContent = AIChatHistoryRowContent(
            summary: summary,
            isCurrent: isCurrent,
            isBusy: rowAction != nil,
            errorMessage: self.model.rowErrors[summary.sessionId]
        )

        Group {
            if isCurrent {
                Button {
                    self.navigation.popAIToLiveChat()
                } label: {
                    rowContent
                }
                .accessibilityIdentifier(UITestIdentifier.aiHistoryCurrentSessionRow)
            } else {
                NavigationLink(value: AIChatHistoryReaderRoute(summary: summary)) {
                    rowContent
                }
                .accessibilityIdentifier(UITestIdentifier.aiHistorySessionRow)
            }
        }
        .disabled(rowAction == .archiving)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button {
                self.archiveTarget = summary
            } label: {
                Label(aiSettingsLocalized("ai.history.archive", "Archive"), systemImage: "archivebox")
            }
            .tint(.red)
            .disabled(isArchiveDisabled)

            Button {
                self.beginRename(summary: summary)
            } label: {
                Label(aiSettingsLocalized("ai.history.rename", "Rename"), systemImage: "pencil")
            }
            .disabled(rowAction != nil)
        }
        .contextMenu {
            Button {
                self.beginRename(summary: summary)
            } label: {
                Label(aiSettingsLocalized("ai.history.rename", "Rename"), systemImage: "pencil")
            }
            .disabled(rowAction != nil)

            Button(role: .destructive) {
                self.archiveTarget = summary
            } label: {
                Label(aiSettingsLocalized("ai.history.archive", "Archive"), systemImage: "archivebox")
            }
            .disabled(isArchiveDisabled)
        }
    }

    private var currentSessionId: String {
        self.chatStore.chatSessionId
    }

    private var isCurrentChatArchiveDisabled: Bool {
        self.chatStore.isChatInteractive == false || self.chatStore.composerPhase != .idle
    }

    private var isRenamePresentedBinding: Binding<Bool> {
        Binding(
            get: {
                self.renameTarget != nil
            },
            set: { isPresented in
                if isPresented == false {
                    self.renameTarget = nil
                }
            }
        )
    }

    private var isArchivePresentedBinding: Binding<Bool> {
        Binding(
            get: {
                self.archiveTarget != nil
            },
            set: { isPresented in
                if isPresented == false {
                    self.archiveTarget = nil
                }
            }
        )
    }

    private func beginRename(summary: AIChatSessionHistorySummary) {
        self.renameDraft = summary.title ?? ""
        self.renameTarget = summary
    }

    /// Archiving the live chat ends it the way New does, then returns to the fresh chat.
    private func archive(summary: AIChatSessionHistorySummary) {
        Task {
            let didArchive = await self.model.archive(summary: summary)
            guard didArchive, summary.sessionId == self.chatStore.chatSessionId else {
                return
            }

            self.chatStore.clearHistory()
            self.navigation.popAIToLiveChat()
        }
    }
}

private struct AIChatHistoryRowContent: View {
    let summary: AIChatSessionHistorySummary
    let isCurrent: Bool
    let isBusy: Bool
    let errorMessage: String?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(self.summary.title ?? aiChatHistoryUntitledChatTitle())
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if self.isCurrent {
                        Text(aiSettingsLocalized("ai.history.current", "Current"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tint)
                    }
                    Spacer(minLength: 0)
                    Text(self.summary.lastActivityDate, format: .relative(presentation: .named))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let preview = self.summary.preview {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let errorMessage = self.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            if self.isBusy {
                ProgressView()
            }
        }
    }
}
