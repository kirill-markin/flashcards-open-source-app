package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

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
