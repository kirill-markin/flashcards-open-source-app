package com.flashcardsopensourceapp.feature.settings.deck

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.cards.DeckDraft
import com.flashcardsopensourceapp.data.local.model.cards.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

sealed interface DeckEditorSaveResult {
    data class Created(
        val deckId: String
    ) : DeckEditorSaveResult

    data object Updated : DeckEditorSaveResult
}

class DeckEditorViewModel(
    private val decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = DeckEditorUiState(
            isLoading = true,
            title = if (editingDeckId == null) {
                strings.get(R.string.settings_deck_editor_new_title)
            } else {
                strings.get(R.string.settings_deck_editor_edit_title)
            },
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

    suspend fun save(editingDeckId: String?): DeckEditorSaveResult? {
        val state = uiState.value
        val trimmedName = state.name.trim()

        if (trimmedName.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = strings.get(R.string.settings_deck_editor_name_required))
            }
            return null
        }

        if (
            isDeckFilterEmpty(
                selectedEffortLevels = state.selectedEffortLevels,
                selectedTags = state.selectedTags
            )
        ) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = strings.get(R.string.settings_deck_editor_filter_required))
            }
            return null
        }

        val deckDraft = DeckDraft(
            name = trimmedName,
            filterDefinition = buildDeckFilterDefinition(
                effortLevels = state.selectedEffortLevels,
                tags = state.selectedTags
            )
        )

        return if (editingDeckId == null) {
            DeckEditorSaveResult.Created(
                deckId = decksRepository.createDeck(deckDraft = deckDraft)
            )
        } else {
            decksRepository.updateDeck(deckId = editingDeckId, deckDraft = deckDraft)
            DeckEditorSaveResult.Updated
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
    editingDeckId: String?,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckEditorViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository,
                editingDeckId = editingDeckId,
                strings = createSettingsStringResolver(context = applicationContext)
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

private fun isDeckFilterEmpty(selectedEffortLevels: List<EffortLevel>, selectedTags: List<String>): Boolean {
    return selectedEffortLevels.isEmpty() && selectedTags.isEmpty()
}
