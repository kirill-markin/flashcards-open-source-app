import Foundation
import Observation

struct AIChatHistoryListRoute: Hashable {}

struct AIChatHistoryReaderRoute: Hashable {
    let summary: AIChatSessionHistorySummary
}

enum AIChatHistoryListPhase: Equatable {
    case loading
    case failed(message: String)
    case loaded
}

enum AIChatHistoryLoadMorePhase: Equatable {
    case idle
    case loading
    case failed(message: String)
}

enum AIChatHistoryRowAction: Equatable {
    case renaming
    case archiving
}

private let aiChatHistorySearchDebounce: Duration = .milliseconds(300)

func aiChatHistorySearchText(query: String) -> String? {
    let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedQuery.isEmpty ? nil : trimmedQuery
}

/// Keeps typed text within a server limit counted in code points, dropping whole characters from the end.
func aiChatHistoryLimitedText(text: String, maximumLength: Int) -> String {
    var limitedText = text
    while limitedText.unicodeScalars.count > maximumLength {
        limitedText.removeLast()
    }
    return limitedText
}

func aiChatHistoryCurrentChatFirst(
    sessions: [AIChatSessionHistorySummary],
    currentSessionId: String
) -> [AIChatSessionHistorySummary] {
    sessions.filter { session in session.sessionId == currentSessionId }
        + sessions.filter { session in session.sessionId != currentSessionId }
}

private func aiChatHistoryAppendingNewSessions(
    sessions: [AIChatSessionHistorySummary],
    nextSessions: [AIChatSessionHistorySummary]
) -> [AIChatSessionHistorySummary] {
    let knownSessionIds = Set(sessions.map(\.sessionId))
    return sessions + nextSessions.filter { session in knownSessionIds.contains(session.sessionId) == false }
}

/// Server-side chat history for the AI tab's workspace; nothing here is persisted on the device.
@MainActor
@Observable
final class AIChatHistoryListModel {
    var searchQuery: String
    private(set) var phase: AIChatHistoryListPhase
    private(set) var sessions: [AIChatSessionHistorySummary]
    private(set) var nextCursor: String?
    private(set) var loadMorePhase: AIChatHistoryLoadMorePhase
    private(set) var rowActions: [String: AIChatHistoryRowAction]
    private(set) var rowErrors: [String: String]
    private(set) var notice: String?
    private(set) var appliedSearchText: String?

    @ObservationIgnored private let chatStore: AIChatStore
    @ObservationIgnored private var hasStartedLoading: Bool
    // A first-page load bumps it, so responses for a replaced query or an older refresh are dropped.
    @ObservationIgnored private var listGeneration: Int
    @ObservationIgnored private var activeFirstPageTask: Task<Void, Never>?
    @ObservationIgnored private var activeNextPageTask: Task<Void, Never>?

    init(chatStore: AIChatStore) {
        self.searchQuery = ""
        self.phase = .loading
        self.sessions = []
        self.nextCursor = nil
        self.loadMorePhase = .idle
        self.rowActions = [:]
        self.rowErrors = [:]
        self.notice = nil
        self.appliedSearchText = nil
        self.chatStore = chatStore
        self.hasStartedLoading = false
        self.listGeneration = 0
        self.activeFirstPageTask = nil
        self.activeNextPageTask = nil
    }

    /// Runs from `.task(id: searchQuery)`, so SwiftUI cancels the debounce whenever the query changes again.
    func handleSearchQueryChange() async {
        let searchText = aiChatHistorySearchText(query: self.searchQuery)
        guard self.hasStartedLoading else {
            self.reload(searchText: searchText)
            return
        }
        guard searchText != self.appliedSearchText else {
            return
        }

        do {
            try await Task.sleep(for: aiChatHistorySearchDebounce)
        } catch {
            return
        }
        self.reload(searchText: searchText)
    }

    func retry() {
        self.phase = .loading
        self.startFirstPageLoad()
    }

    /// Keeps the visible rows until the fresh first page arrives.
    func refresh() async {
        self.startFirstPageLoad()
        await self.activeFirstPageTask?.value
    }

    func loadNextPage() {
        guard self.phase == .loaded, let cursor = self.nextCursor, self.loadMorePhase != .loading else {
            return
        }

        let generation = self.listGeneration
        let searchText = self.appliedSearchText
        self.loadMorePhase = .loading
        self.activeNextPageTask = Task {
            do {
                let page = try await self.loadPage(cursor: cursor, searchText: searchText)
                guard generation == self.listGeneration else {
                    return
                }
                self.sessions = aiChatHistoryAppendingNewSessions(sessions: self.sessions, nextSessions: page.sessions)
                self.nextCursor = page.nextCursor
                self.loadMorePhase = .idle
            } catch {
                guard generation == self.listGeneration, isRequestCancellationError(error: error) == false else {
                    return
                }
                self.loadMorePhase = .failed(message: errorMessage(error: error))
            }
        }
    }

    func rename(summary: AIChatSessionHistorySummary, title: String) async {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            return
        }

        let sessionId = summary.sessionId
        self.rowErrors[sessionId] = nil
        self.rowActions[sessionId] = .renaming
        self.replaceSession(
            summary: AIChatSessionHistorySummary(
                sessionId: summary.sessionId,
                title: trimmedTitle,
                hasCustomTitle: true,
                preview: summary.preview,
                messageCount: summary.messageCount,
                createdAt: summary.createdAt,
                lastActivityAt: summary.lastActivityAt
            )
        )
        do {
            let session = try await self.chatStore.flashcardsStore.cloudSessionForAI()
            let renamedSummary = try await self.chatStore.chatService.renameChatSession(
                session: session,
                sessionId: sessionId,
                title: trimmedTitle
            )
            self.replaceSession(summary: renamedSummary)
        } catch {
            if isAIChatSessionUnavailableError(error: error) {
                self.removeUnavailableSession(sessionId: sessionId)
            } else {
                self.replaceSession(summary: summary)
                self.rowErrors[sessionId] = aiSettingsLocalized(
                    "ai.history.renameError",
                    "Couldn't rename this chat. Try again."
                )
            }
        }
        self.rowActions[sessionId] = nil
    }

    /// Returns whether the chat is gone from the server; a 404 means it was already archived.
    func archive(summary: AIChatSessionHistorySummary) async -> Bool {
        let sessionId = summary.sessionId
        self.rowErrors[sessionId] = nil
        self.rowActions[sessionId] = .archiving
        do {
            let session = try await self.chatStore.flashcardsStore.cloudSessionForAI()
            _ = try await self.chatStore.chatService.archiveChatSession(session: session, sessionId: sessionId)
        } catch {
            if isAIChatSessionUnavailableError(error: error) == false {
                self.rowActions[sessionId] = nil
                self.rowErrors[sessionId] = isAIChatSessionArchiveActiveRunError(error: error)
                    ? aiSettingsLocalized(
                        "ai.history.archiveActiveRunError",
                        "Stop the current response before archiving this chat."
                    )
                    : aiSettingsLocalized("ai.history.archiveError", "Couldn't archive this chat. Try again.")
                return false
            }
        }

        self.rowActions[sessionId] = nil
        self.removeSession(sessionId: sessionId)
        return true
    }

    func removeUnavailableSession(sessionId: String) {
        self.removeSession(sessionId: sessionId)
        self.notice = aiSettingsLocalized("ai.history.unavailable", "This chat is no longer available.")
    }

    private func reload(searchText: String?) {
        self.hasStartedLoading = true
        self.appliedSearchText = searchText
        self.phase = .loading
        self.sessions = []
        self.nextCursor = nil
        self.startFirstPageLoad()
    }

    private func startFirstPageLoad() {
        self.listGeneration += 1
        let generation = self.listGeneration
        let searchText = self.appliedSearchText
        self.activeFirstPageTask?.cancel()
        self.activeNextPageTask?.cancel()
        self.loadMorePhase = .idle
        self.notice = nil
        self.activeFirstPageTask = Task {
            do {
                let page = try await self.loadPage(cursor: nil, searchText: searchText)
                guard generation == self.listGeneration else {
                    return
                }
                self.sessions = page.sessions
                self.nextCursor = page.nextCursor
                self.phase = .loaded
            } catch {
                guard generation == self.listGeneration, isRequestCancellationError(error: error) == false else {
                    return
                }
                self.phase = .failed(message: errorMessage(error: error))
            }
        }
    }

    private func loadPage(cursor: String?, searchText: String?) async throws -> AIChatSessionHistoryPage {
        let session = try await self.chatStore.flashcardsStore.cloudSessionForAI()
        return try await self.chatStore.chatService.listChatSessions(
            session: session,
            cursor: cursor,
            searchText: searchText
        )
    }

    private func replaceSession(summary: AIChatSessionHistorySummary) {
        self.sessions = self.sessions.map { session in
            session.sessionId == summary.sessionId ? summary : session
        }
    }

    private func removeSession(sessionId: String) {
        self.sessions.removeAll { session in session.sessionId == sessionId }
    }
}
