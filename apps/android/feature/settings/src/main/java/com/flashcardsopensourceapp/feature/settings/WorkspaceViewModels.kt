package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class WorkspaceSettingsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<WorkspaceSettingsUiState> = workspaceRepository.observeWorkspaceOverview().map { overview ->
        WorkspaceSettingsUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            deckCount = overview?.deckCount ?: 0,
            totalCards = overview?.totalCards ?: 0,
            tagCount = overview?.tagsCount ?: 0
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceSettingsUiState(
            workspaceName = "Loading...",
            deckCount = 0,
            totalCards = 0,
            tagCount = 0
        )
    )
}

class WorkspaceOverviewViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<WorkspaceOverviewUiState> = workspaceRepository.observeWorkspaceOverview().map { overview ->
        WorkspaceOverviewUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            totalCards = overview?.totalCards ?: 0,
            deckCount = overview?.deckCount ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            dueCount = overview?.dueCount ?: 0,
            newCount = overview?.newCount ?: 0,
            reviewedCount = overview?.reviewedCount ?: 0
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceOverviewUiState(
            workspaceName = "Loading...",
            totalCards = 0,
            deckCount = 0,
            tagCount = 0,
            dueCount = 0,
            newCount = 0,
            reviewedCount = 0
        )
    )
}

class DecksViewModel(
    decksRepository: DecksRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<DecksUiState> = combine(
        decksRepository.observeDecks(),
        searchQuery
    ) { decks, query ->
        DecksUiState(
            searchQuery = query,
            decks = filterDecks(decks = decks, searchQuery = query)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DecksUiState(
            searchQuery = "",
            decks = emptyList()
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

class DeckDetailViewModel(
    decksRepository: DecksRepository,
    deckId: String
) : ViewModel() {
    val uiState: StateFlow<DeckDetailUiState> = combine(
        decksRepository.observeDeck(deckId = deckId),
        decksRepository.observeDeckCards(deckId = deckId)
    ) { deck, cards ->
        DeckDetailUiState(
            deck = deck,
            cards = cards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeckDetailUiState(
            deck = null,
            cards = emptyList()
        )
    )
}

class DeckEditorViewModel(
    private val decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = DeckEditorUiState(
            isLoading = true,
            title = if (editingDeckId == null) "New deck" else "Edit deck",
            isEditing = editingDeckId != null,
            name = "",
            selectedEffortLevels = emptyList(),
            selectedTags = emptyList(),
            availableTags = emptyList(),
            errorMessage = ""
        )
    )

    val uiState: StateFlow<DeckEditorUiState> = combine(
        if (editingDeckId == null) {
            flowOf(null)
        } else {
            decksRepository.observeDeck(deckId = editingDeckId)
        },
        workspaceRepository.observeWorkspaceTagsSummary(),
        inputState
    ) { deck, tagsSummary, currentState ->
        currentState.copy(
            isLoading = false,
            availableTags = tagsSummary.tags,
            name = if (currentState.name.isEmpty() && deck != null) deck.name else currentState.name,
            selectedEffortLevels = if (currentState.selectedEffortLevels.isEmpty() && deck != null) {
                deck.filterDefinition.effortLevels
            } else {
                currentState.selectedEffortLevels
            },
            selectedTags = if (currentState.selectedTags.isEmpty() && deck != null) {
                deck.filterDefinition.tags
            } else {
                currentState.selectedTags
            }
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = inputState.value
    )

    fun updateName(name: String) {
        inputState.update { state ->
            state.copy(name = name, errorMessage = "")
        }
    }

    fun toggleEffortLevel(effortLevel: EffortLevel) {
        inputState.update { state ->
            state.copy(
                selectedEffortLevels = toggleEffortLevelSelection(
                    selectedEffortLevels = state.selectedEffortLevels,
                    effortLevel = effortLevel
                ),
                errorMessage = ""
            )
        }
    }

    fun toggleTag(tag: String) {
        inputState.update { state ->
            state.copy(
                selectedTags = toggleTagSelection(
                    selectedTags = state.selectedTags,
                    tag = tag
                ),
                errorMessage = ""
            )
        }
    }

    suspend fun save(editingDeckId: String?): Boolean {
        val state = uiState.value
        val trimmedName = state.name.trim()

        if (trimmedName.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = "Deck name is required.")
            }
            return false
        }

        val deckDraft = DeckDraft(
            name = trimmedName,
            filterDefinition = buildDeckFilterDefinition(
                effortLevels = state.selectedEffortLevels,
                tags = state.selectedTags
            )
        )

        return if (editingDeckId == null) {
            decksRepository.createDeck(deckDraft = deckDraft)
            true
        } else {
            decksRepository.updateDeck(deckId = editingDeckId, deckDraft = deckDraft)
            true
        }
    }

    suspend fun delete(editingDeckId: String): Boolean {
        decksRepository.deleteDeck(deckId = editingDeckId)
        return true
    }
}

class WorkspaceTagsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<WorkspaceTagsUiState> = combine(
        workspaceRepository.observeWorkspaceTagsSummary(),
        searchQuery
    ) { tagsSummary, query ->
        WorkspaceTagsUiState(
            searchQuery = query,
            tags = filterTags(
                tags = tagsSummary.tags,
                searchQuery = query
            ),
            totalCards = tagsSummary.totalCards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceTagsUiState(
            searchQuery = "",
            tags = emptyList(),
            totalCards = 0
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

fun createWorkspaceSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceSettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createWorkspaceOverviewViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceOverviewViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createDecksViewModelFactory(decksRepository: DecksRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DecksViewModel(decksRepository = decksRepository)
        }
    }
}

fun createDeckDetailViewModelFactory(decksRepository: DecksRepository, deckId: String): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckDetailViewModel(
                decksRepository = decksRepository,
                deckId = deckId
            )
        }
    }
}

fun createDeckEditorViewModelFactory(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckEditorViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository,
                editingDeckId = editingDeckId
            )
        }
    }
}

fun createWorkspaceTagsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceTagsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

private fun filterDecks(decks: List<DeckSummary>, searchQuery: String): List<DeckSummary> {
    val normalizedQuery = searchQuery.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return decks
    }

    return decks.filter { deck ->
        deck.name.lowercase().contains(normalizedQuery)
            || formatDeckFilter(deck.filterDefinition).lowercase().contains(normalizedQuery)
    }
}

private fun filterTags(tags: List<WorkspaceTagSummary>, searchQuery: String): List<WorkspaceTagSummary> {
    val normalizedQuery = searchQuery.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return tags
    }

    return tags.filter { tagSummary ->
        tagSummary.tag.lowercase().contains(normalizedQuery)
    }
}

private fun toggleEffortLevelSelection(selectedEffortLevels: List<EffortLevel>, effortLevel: EffortLevel): List<EffortLevel> {
    if (selectedEffortLevels.contains(effortLevel)) {
        return selectedEffortLevels.filter { value ->
            value != effortLevel
        }
    }

    return selectedEffortLevels + effortLevel
}

private fun toggleTagSelection(selectedTags: List<String>, tag: String): List<String> {
    if (selectedTags.contains(tag)) {
        return selectedTags.filter { value ->
            value != tag
        }
    }

    return selectedTags + tag
}

private fun formatDeckFilter(filterDefinition: DeckFilterDefinition): String {
    val parts = buildList {
        if (filterDefinition.effortLevels.isNotEmpty()) {
            add("effort in ${filterDefinition.effortLevels.joinToString(separator = ", ") { effortLevel -> effortLevel.name.lowercase() }}")
        }
        if (filterDefinition.tags.isNotEmpty()) {
            add("tags any of ${filterDefinition.tags.joinToString(separator = ", ")}")
        }
    }

    if (parts.isEmpty()) {
        return "All cards"
    }

    return parts.joinToString(separator = " AND ")
}
