import SwiftUI

func aiChatHistoryUntitledChatTitle() -> String {
    aiSettingsLocalized("ai.history.untitledChat", "Untitled chat")
}

@MainActor
func aiChatHistoryScope(flashcardsStore: FlashcardsStore) -> [String?] {
    [
        flashcardsStore.workspace?.workspaceId,
        flashcardsStore.cloudSettings?.activeWorkspaceId,
        flashcardsStore.cloudSettings?.linkedUserId
    ]
}

/// A guest's first sign-in keeps the guest workspace's chats, so it leaves chat history open.
func isPreservedGuestHistoryBootstrap(
    previousScope: [String?],
    nextScope: [String?],
    link: PreservedGuestWorkspaceLink?
) -> Bool {
    guard let link else { return false }
    return previousScope == [link.sourceWorkspaceId, link.sourceWorkspaceId, nil]
        && nextScope == [link.targetWorkspaceId, link.targetWorkspaceId, link.userId]
}

extension View {
    /// The history pages of the AI tab's stack, declared at its root, so an old chat opens from a pushed history page.
    func aiChatHistoryDestinations(chatStore: AIChatStore) -> some View {
        self
            .navigationDestination(for: AIChatHistoryListRoute.self) { route in
                AIChatHistoryView(chatStore: chatStore, model: route.model)
                    .aiCompanionColumnPage()
                    #if targetEnvironment(macCatalyst)
                    .environment(\.macToolbarOwnerTab, .ai)
                    #endif
            }
            .navigationDestination(for: AIChatHistoryReaderRoute.self) { route in
                AIChatHistoryReaderView(
                    chatStore: chatStore,
                    summary: route.summary,
                    model: route.list.makeReaderModel(sessionId: route.summary.sessionId)
                )
                .aiCompanionColumnPage()
                #if targetEnvironment(macCatalyst)
                .environment(\.macToolbarOwnerTab, .ai)
                #endif
            }
    }
}

struct AIChatHistoryView: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.aiCompanionHostTab) private var companionHostTab
    @Environment(\.aiCompanionPaneSharesSectionBar) private var sharesSectionBar
    @Environment(\.aiCompanionPageIsTop) private var isOnTopPage
    private var isInPane: Bool { self.companionHostTab != nil }
    let chatStore: AIChatStore
    @Bindable private var model: AIChatHistoryListModel
    @State private var isSearchPresented = false
    @State private var renameTarget: AIChatSessionHistorySummary?
    @State private var renameDraft: String
    @State private var archiveTarget: AIChatSessionHistorySummary?

    @MainActor
    init(chatStore: AIChatStore, model: AIChatHistoryListModel) {
        self.chatStore = chatStore
        self.model = model
        self._renameTarget = State(initialValue: nil)
        self._renameDraft = State(initialValue: "")
        self._archiveTarget = State(initialValue: nil)
    }

    var body: some View {
        self.content
            .aiCompanionPageTitle(aiSettingsLocalized("ai.history.title", "Chat history"), sharesSectionBar: self.sharesSectionBar) {
                self.paneSearchField
            }
            #if targetEnvironment(macCatalyst)
            .macToolbarContribution(MacToolbarContribution(
                tab: .ai,
                role: .navigation,
                search: MacToolbarSearch(
                    text: self.model.searchQuery,
                    prompt: aiSettingsLocalized("ai.history.searchPlaceholder", "Search chats"),
                    focusRequest: nil,
                    onChange: { self.model.searchQuery = $0 },
                    onFocusRequestHandled: {}
                )
            ))
            #endif
            .onChange(of: self.canSearch) { _, canSearch in
                if canSearch == false {
                    self.isSearchPresented = false
                }
            }
            .onDisappear {
                self.isSearchPresented = false
            }
            .task(id: self.isVisible ? self.model.searchQuery : nil) {
                guard self.isVisible else { return }
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

    private var isVisible: Bool {
        if let companionHostTab = self.companionHostTab {
            guard self.navigation.isAICompanionVisible,
                  self.navigation.selectedTab == companionHostTab,
                  self.isOnTopPage,
                  case .history(let route)? = self.navigation.aiCompanionPath.last else {
                return false
            }
            return route.model === self.model
        }
        return self.navigation.selectedTab == .ai && self.navigation.aiPath.count == 1
    }

    private var canSearch: Bool {
        self.isVisible && self.renameTarget == nil && self.archiveTarget == nil
    }

    @ViewBuilder
    private var content: some View {
        if self.sharesSectionBar {
            self.sessionList
        } else {
            self.searchableSessionList
        }
    }

    /// The pane's search, under its heading. `.searchable` would attach its drawer to the section's bar, which the pane
    /// shares on iPad, so the pane hosts a system search bar of its own.
    @ViewBuilder
    private var paneSearchField: some View {
        #if !targetEnvironment(macCatalyst)
        if self.sharesSectionBar {
            AIChatHistoryPaneSearchBar(
                text: self.searchQueryBinding,
                placeholder: aiSettingsLocalized("ai.history.searchPlaceholder", "Search chats"),
                isEnabled: self.canSearch
            )
            .accessibilityIdentifier(UITestIdentifier.aiHistorySearchField)
        }
        #endif
    }

    private var searchableSessionList: some View {
        self.sessionList
            #if !targetEnvironment(macCatalyst)
            .searchable(
                text: self.searchQueryBinding,
                isPresented: self.isSearchPresentedBinding,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(verbatim: aiSettingsLocalized("ai.history.searchPlaceholder", "Search chats"))
            )
            #endif
    }

    private var searchQueryBinding: Binding<String> {
        Binding(
            get: { self.model.searchQuery },
            set: { query in
                if self.canSearch {
                    self.model.searchQuery = query
                }
            }
        )
    }

    private var isSearchPresentedBinding: Binding<Bool> {
        Binding(
            get: { self.canSearch && self.isSearchPresented },
            set: { isPresented in
                self.isSearchPresented = self.canSearch && isPresented
            }
        )
    }

    private var sessionList: some View {
        let phase = self.model.phase
        let sessions = phase == .loaded ? aiChatHistoryCurrentChatFirst(
            sessions: self.model.sessions,
            currentSessionId: self.currentSessionId
        ) : []
        return List {
            switch phase {
            case .loading:
                ProgressView(aiSettingsLocalized("ai.history.loading", "Loading chats..."))
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
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
                .listRowSeparator(.hidden)
            case .loaded:
                if let notice = self.model.notice {
                    Text(notice)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                ForEach(sessions) { summary in
                    self.sessionRow(summary: summary)
                        .aiCompanionScrollRow(id: summary.sessionId)
                }

                if self.model.nextCursor != nil {
                    self.loadMoreRow
                } else if sessions.isEmpty {
                    self.emptyState
                        .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await self.model.refresh()
        }
        .aiCompanionPageScroll(rowIDs: sessions.map(\.sessionId))
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
            } else if self.isInPane {
                Button {
                    self.isSearchPresented = false
                    let route = AICompanionHistoryReaderRoute(
                        summary: summary,
                        model: self.model.makeReaderModel(sessionId: summary.sessionId)
                    )
                    self.navigation.aiCompanionPath.append(.reader(route))
                } label: {
                    rowContent
                }
                .tint(Color.primary)
                .accessibilityIdentifier(UITestIdentifier.aiHistorySessionRow)
            } else {
                NavigationLink(value: AIChatHistoryReaderRoute(summary: summary, list: self.model)) {
                    rowContent
                }
                .accessibilityIdentifier(UITestIdentifier.aiHistorySessionRow)
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        .alignmentGuide(.listRowSeparatorLeading) { dimensions in dimensions[.leading] }
        .alignmentGuide(.listRowSeparatorTrailing) { dimensions in dimensions[.trailing] }
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
        self.isSearchPresented = false
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
                    MathContentText(text: self.summary.title ?? aiChatHistoryUntitledChatTitle(), textStyle: .headline, weight: .semibold, lineLimit: 1)
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
                    MathContentText(text: preview, textStyle: .subheadline, color: .secondaryLabel, lineLimit: 1)
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

#if !targetEnvironment(macCatalyst)
/// A minimal system search bar: its clear button, keyboard search key and accessibility come from UIKit.
private struct AIChatHistoryPaneSearchBar: UIViewRepresentable {
    @Binding var text: String
    let placeholder: String
    let isEnabled: Bool

    func makeCoordinator() -> Coordinator { Coordinator(text: self.$text) }

    func makeUIView(context: Context) -> UISearchBar {
        let searchBar = UISearchBar()
        searchBar.searchBarStyle = .minimal
        searchBar.autocapitalizationType = .none
        searchBar.autocorrectionType = .no
        searchBar.delegate = context.coordinator
        searchBar.setContentHuggingPriority(.required, for: .vertical)
        return searchBar
    }

    func updateUIView(_ searchBar: UISearchBar, context: Context) {
        context.coordinator.text = self.$text
        if searchBar.text != self.text { searchBar.text = self.text }
        searchBar.placeholder = self.placeholder
        searchBar.isUserInteractionEnabled = self.isEnabled
        searchBar.searchTextField.isEnabled = self.isEnabled
    }

    final class Coordinator: NSObject, UISearchBarDelegate {
        var text: Binding<String>

        init(text: Binding<String>) { self.text = text }

        func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
            self.text.wrappedValue = searchText
        }

        /// The query already applies as it is typed; the search key only puts the keyboard away.
        func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
            searchBar.resignFirstResponder()
        }
    }
}
#endif
