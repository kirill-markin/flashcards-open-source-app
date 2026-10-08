package com.flashcardsopensourceapp.feature.ai.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatSessionArchiveActiveRunRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatSessionUnavailableRemoteError
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistorySummary
import com.flashcardsopensourceapp.data.local.model.ai.aiChatSessionsSearchMaximumLength
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val aiChatHistorySearchDebounceMillis: Long = 300L

sealed interface AiChatHistoryListState {
    data object Loading : AiChatHistoryListState
    data object Failed : AiChatHistoryListState
    data class Loaded(
        val sessions: List<AiChatSessionHistorySummary>,
        val nextCursor: String?,
        /** The search the list answers; null for the unfiltered list. */
        val searchText: String?
    ) : AiChatHistoryListState
}

enum class AiChatHistoryLoadMoreState {
    IDLE,
    LOADING,
    FAILED
}

enum class AiChatHistoryRowAction {
    RENAMING,
    ARCHIVING
}

enum class AiChatHistoryRowError {
    RENAME_FAILED,
    ARCHIVE_FAILED,
    ARCHIVE_ACTIVE_RUN
}

sealed interface AiChatHistoryReaderState {
    data object Loading : AiChatHistoryReaderState
    data object Unavailable : AiChatHistoryReaderState
    data object Failed : AiChatHistoryReaderState
    data class Loaded(val messages: List<AiChatMessage>) : AiChatHistoryReaderState
}

data class AiChatHistoryReader(
    val sessionId: String,
    /** The list row the chat was opened from, kept after the row leaves the list; null if never listed. */
    val summary: AiChatSessionHistorySummary?,
    val state: AiChatHistoryReaderState
)

data class AiChatHistoryUiState(
    val searchQuery: String,
    val listState: AiChatHistoryListState,
    val loadMoreState: AiChatHistoryLoadMoreState,
    val isRefreshing: Boolean,
    val rowActions: Map<String, AiChatHistoryRowAction>,
    val rowErrors: Map<String, AiChatHistoryRowError>,
    /** A row vanished because the server no longer has that chat. */
    val showsUnavailableNotice: Boolean,
    val reader: AiChatHistoryReader?,
    /** The live chat archived from here; the live chat must start a fresh chat and take over. */
    val archivedCurrentSessionId: String?
)

private data class AiChatHistoryFirstPageRequest(
    val searchText: String?,
    val isPullToRefresh: Boolean,
    val version: Long
)

/** Server-backed chat history of one workspace; nothing here is cached on the device. */
@OptIn(FlowPreview::class)
class AiChatHistoryViewModel(
    private val aiChatRepository: AiChatRepository,
    private val workspaceId: String
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow(
        value = AiChatHistoryUiState(
            searchQuery = "",
            listState = AiChatHistoryListState.Loading,
            loadMoreState = AiChatHistoryLoadMoreState.IDLE,
            isRefreshing = false,
            rowActions = emptyMap(),
            rowErrors = emptyMap(),
            showsUnavailableNotice = false,
            reader = null,
            archivedCurrentSessionId = null
        )
    )
    val uiState: StateFlow<AiChatHistoryUiState> = uiStateMutable.asStateFlow()

    private val searchQuery = MutableStateFlow(value = "")
    private val firstPageRequests = MutableStateFlow(
        value = AiChatHistoryFirstPageRequest(
            searchText = null,
            isPullToRefresh = false,
            version = 0L
        )
    )
    private var loadMoreJob: Job? = null
    private var readerJob: Job? = null

    init {
        // collectLatest cancels the request a newer search or reload replaces, so a stale page never lands.
        viewModelScope.launch {
            firstPageRequests.collectLatest { request ->
                loadFirstPage(request = request)
            }
        }
        viewModelScope.launch {
            searchQuery
                .debounce { query ->
                    if (query.isBlank()) 0L else aiChatHistorySearchDebounceMillis
                }
                .map(::normalizeAiChatHistorySearchText)
                .distinctUntilChanged()
                .collect { searchText ->
                    if (searchText != firstPageRequests.value.searchText) {
                        firstPageRequests.update { request ->
                            AiChatHistoryFirstPageRequest(
                                searchText = searchText,
                                isPullToRefresh = false,
                                version = request.version + 1L
                            )
                        }
                    }
                }
        }
    }

    fun updateSearchQuery(query: String) {
        val limitedQuery = query.take(n = aiChatSessionsSearchMaximumLength)
        uiStateMutable.update { state ->
            state.copy(searchQuery = limitedQuery)
        }
        searchQuery.value = limitedQuery
    }

    fun refresh() {
        firstPageRequests.update { request ->
            request.copy(isPullToRefresh = true, version = request.version + 1L)
        }
    }

    fun retry() {
        firstPageRequests.update { request ->
            request.copy(isPullToRefresh = false, version = request.version + 1L)
        }
    }

    fun loadMore() {
        val state = uiStateMutable.value
        val listState = state.listState as? AiChatHistoryListState.Loaded ?: return
        val cursor = listState.nextCursor ?: return
        if (state.loadMoreState == AiChatHistoryLoadMoreState.LOADING) {
            return
        }

        uiStateMutable.update { currentState ->
            currentState.copy(loadMoreState = AiChatHistoryLoadMoreState.LOADING)
        }
        loadMoreJob = viewModelScope.launch {
            try {
                val page = aiChatRepository.listChatSessions(
                    workspaceId = workspaceId,
                    cursor = cursor,
                    searchText = listState.searchText
                )
                uiStateMutable.update { currentState ->
                    val currentListState = currentState.listState as? AiChatHistoryListState.Loaded
                        ?: return@update currentState
                    currentState.copy(
                        listState = currentListState.copy(
                            sessions = appendNewAiChatSessions(
                                sessions = currentListState.sessions,
                                nextSessions = page.sessions
                            ),
                            nextCursor = page.nextCursor
                        ),
                        loadMoreState = AiChatHistoryLoadMoreState.IDLE
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logAiChatHistoryFailure(event = "ai_chat_history_load_more_failed", sessionId = null, error = error)
                uiStateMutable.update { currentState ->
                    currentState.copy(loadMoreState = AiChatHistoryLoadMoreState.FAILED)
                }
            }
        }
    }

    fun renameSession(summary: AiChatSessionHistorySummary, title: String) {
        val trimmedTitle = title.trim()
        require(trimmedTitle.isNotEmpty()) {
            "AI chat history rename requires a non-empty title. sessionId=${summary.sessionId}"
        }
        uiStateMutable.update { state ->
            replaceAiChatSession(
                state = state.copy(
                    rowActions = state.rowActions + (summary.sessionId to AiChatHistoryRowAction.RENAMING),
                    rowErrors = state.rowErrors - summary.sessionId
                ),
                summary = summary.copy(title = trimmedTitle, hasCustomTitle = true)
            )
        }
        viewModelScope.launch {
            try {
                val renamedSummary = aiChatRepository.renameChatSession(
                    workspaceId = workspaceId,
                    sessionId = summary.sessionId,
                    title = trimmedTitle
                )
                uiStateMutable.update { state ->
                    replaceAiChatSession(
                        state = state.copy(rowActions = state.rowActions - summary.sessionId),
                        summary = renamedSummary
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (error is AiChatRemoteException && isAiChatSessionUnavailableRemoteError(error = error)) {
                    uiStateMutable.update { state ->
                        removeUnavailableAiChatSession(
                            state = state.copy(rowActions = state.rowActions - summary.sessionId),
                            sessionId = summary.sessionId
                        )
                    }
                    return@launch
                }

                logAiChatHistoryFailure(event = "ai_chat_history_rename_failed", sessionId = summary.sessionId, error = error)
                uiStateMutable.update { state ->
                    replaceAiChatSession(
                        state = state.copy(
                            rowActions = state.rowActions - summary.sessionId,
                            rowErrors = state.rowErrors + (summary.sessionId to AiChatHistoryRowError.RENAME_FAILED)
                        ),
                        summary = summary
                    )
                }
            }
        }
    }

    fun archiveSession(summary: AiChatSessionHistorySummary, currentSessionId: String?) {
        uiStateMutable.update { state ->
            state.copy(
                rowActions = state.rowActions + (summary.sessionId to AiChatHistoryRowAction.ARCHIVING),
                rowErrors = state.rowErrors - summary.sessionId
            )
        }
        viewModelScope.launch {
            try {
                aiChatRepository.archiveChatSession(
                    workspaceId = workspaceId,
                    sessionId = summary.sessionId
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // A 404 means the chat is already archived, which is the outcome this action wants.
                if (error !is AiChatRemoteException || isAiChatSessionUnavailableRemoteError(error = error).not()) {
                    val rowError = if (
                        error is AiChatRemoteException && isAiChatSessionArchiveActiveRunRemoteError(error = error)
                    ) {
                        AiChatHistoryRowError.ARCHIVE_ACTIVE_RUN
                    } else {
                        logAiChatHistoryFailure(
                            event = "ai_chat_history_archive_failed",
                            sessionId = summary.sessionId,
                            error = error
                        )
                        AiChatHistoryRowError.ARCHIVE_FAILED
                    }
                    uiStateMutable.update { state ->
                        state.copy(
                            rowActions = state.rowActions - summary.sessionId,
                            rowErrors = state.rowErrors + (summary.sessionId to rowError)
                        )
                    }
                    return@launch
                }
            }

            uiStateMutable.update { state ->
                removeAiChatSession(
                    state = state.copy(
                        rowActions = state.rowActions - summary.sessionId,
                        archivedCurrentSessionId = if (summary.sessionId == currentSessionId) {
                            summary.sessionId
                        } else {
                            state.archivedCurrentSessionId
                        }
                    ),
                    sessionId = summary.sessionId
                )
            }
        }
    }

    fun consumeArchivedCurrentChat() {
        uiStateMutable.update { state ->
            state.copy(archivedCurrentSessionId = null)
        }
    }

    /** Loads the chat once per session; a failed load reloads, which is also how the reader retries. */
    fun openReader(sessionId: String) {
        val reader = uiStateMutable.value.reader
        if (reader != null && reader.sessionId == sessionId && reader.state != AiChatHistoryReaderState.Failed) {
            return
        }

        readerJob?.cancel()
        uiStateMutable.update { state ->
            val listedSummary = (state.listState as? AiChatHistoryListState.Loaded)
                ?.sessions
                ?.firstOrNull { session -> session.sessionId == sessionId }
            state.copy(
                reader = AiChatHistoryReader(
                    sessionId = sessionId,
                    summary = listedSummary ?: reader?.takeIf { previous -> previous.sessionId == sessionId }?.summary,
                    state = AiChatHistoryReaderState.Loading
                )
            )
        }
        readerJob = viewModelScope.launch {
            try {
                val snapshot = aiChatRepository.loadChatSnapshot(
                    workspaceId = workspaceId,
                    sessionId = sessionId
                )
                if (snapshot == null) {
                    uiStateMutable.update { state ->
                        removeUnavailableAiChatSession(
                            state = state.copy(
                                reader = state.reader?.copy(state = AiChatHistoryReaderState.Unavailable)
                            ),
                            sessionId = sessionId
                        )
                    }
                    return@launch
                }

                uiStateMutable.update { state ->
                    state.copy(
                        reader = state.reader?.copy(
                            state = AiChatHistoryReaderState.Loaded(messages = snapshot.conversation.messages)
                        )
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logAiChatHistoryFailure(event = "ai_chat_history_read_failed", sessionId = sessionId, error = error)
                uiStateMutable.update { state ->
                    state.copy(
                        reader = state.reader?.copy(state = AiChatHistoryReaderState.Failed)
                    )
                }
            }
        }
    }

    private suspend fun loadFirstPage(request: AiChatHistoryFirstPageRequest) {
        loadMoreJob?.cancel()
        uiStateMutable.update { state ->
            val keepsVisibleList = request.isPullToRefresh && state.listState is AiChatHistoryListState.Loaded
            state.copy(
                listState = if (keepsVisibleList) state.listState else AiChatHistoryListState.Loading,
                loadMoreState = AiChatHistoryLoadMoreState.IDLE,
                isRefreshing = request.isPullToRefresh,
                showsUnavailableNotice = false
            )
        }
        try {
            val page = aiChatRepository.listChatSessions(
                workspaceId = workspaceId,
                cursor = null,
                searchText = request.searchText
            )
            uiStateMutable.update { state ->
                state.copy(
                    listState = AiChatHistoryListState.Loaded(
                        sessions = page.sessions,
                        nextCursor = page.nextCursor,
                        searchText = request.searchText
                    ),
                    isRefreshing = false
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logAiChatHistoryFailure(event = "ai_chat_history_list_failed", sessionId = null, error = error)
            uiStateMutable.update { state ->
                state.copy(
                    listState = AiChatHistoryListState.Failed,
                    isRefreshing = false
                )
            }
        }
    }

    private fun logAiChatHistoryFailure(event: String, sessionId: String?, error: Exception) {
        val remoteError = error as? AiChatRemoteException
        AiChatDiagnosticsLogger.error(
            event = event,
            fields = listOf(
                "workspaceId" to workspaceId,
                "sessionId" to sessionId,
                "requestId" to remoteError?.requestId,
                "statusCode" to remoteError?.statusCode?.toString(),
                "code" to remoteError?.code
            ),
            throwable = error
        )
    }
}

fun createAiChatHistoryViewModelFactory(
    aiChatRepository: AiChatRepository,
    workspaceId: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiChatHistoryViewModel(
                aiChatRepository = aiChatRepository,
                workspaceId = workspaceId
            )
        }
    }
}

private fun normalizeAiChatHistorySearchText(query: String): String? {
    return query.trim().ifEmpty { null }
}

private fun appendNewAiChatSessions(
    sessions: List<AiChatSessionHistorySummary>,
    nextSessions: List<AiChatSessionHistorySummary>
): List<AiChatSessionHistorySummary> {
    val knownSessionIds = sessions.map { session -> session.sessionId }.toSet()
    return sessions + nextSessions.filter { session -> knownSessionIds.contains(session.sessionId).not() }
}

private fun updateLoadedAiChatSessions(
    state: AiChatHistoryUiState,
    transform: (List<AiChatSessionHistorySummary>) -> List<AiChatSessionHistorySummary>
): AiChatHistoryUiState {
    val listState = state.listState as? AiChatHistoryListState.Loaded ?: return state
    return state.copy(listState = listState.copy(sessions = transform(listState.sessions)))
}

private fun replaceAiChatSession(
    state: AiChatHistoryUiState,
    summary: AiChatSessionHistorySummary
): AiChatHistoryUiState {
    return updateLoadedAiChatSessions(state = state) { sessions ->
        sessions.map { session ->
            if (session.sessionId == summary.sessionId) summary else session
        }
    }
}

private fun removeAiChatSession(
    state: AiChatHistoryUiState,
    sessionId: String
): AiChatHistoryUiState {
    return updateLoadedAiChatSessions(state = state) { sessions ->
        sessions.filter { session -> session.sessionId != sessionId }
    }
}

private fun removeUnavailableAiChatSession(
    state: AiChatHistoryUiState,
    sessionId: String
): AiChatHistoryUiState {
    return removeAiChatSession(
        state = state.copy(showsUnavailableNotice = true),
        sessionId = sessionId
    )
}
