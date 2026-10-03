package com.flashcardsopensourceapp.feature.settings.deck

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.cards.DeckDraft
import com.flashcardsopensourceapp.data.local.model.cards.DeckSummary
import com.flashcardsopensourceapp.data.local.model.cards.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

sealed interface DeckEditorSaveResult {
    data class Created(
        val deckId: String
    ) : DeckEditorSaveResult

    data object Updated : DeckEditorSaveResult
}

class DeckEditorViewModel(
    private val decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    private val editingDeckId: String?,
    private val technicalErrorController: AppTechnicalErrorController,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val submissionMutex = Mutex()
    private val inputState = MutableStateFlow(
        value = DeckEditorInputState(
            name = "",
            selectedTags = emptyList(),
            errorMessage = "",
            loadedEditingDeckId = null,
            persistedDeckName = null,
            isSubmitting = false,
            isEditingDeckMissing = false
        )
    )

    init {
        val deckId: String? = editingDeckId
        if (deckId != null) {
            viewModelScope.launch {
                decksRepository.observeDeck(deckId = deckId).collect { deck ->
                    inputState.update { currentState ->
                        applyObservedEditingDeck(
                            currentState = currentState,
                            deck = deck
                        )
                    }
                }
            }
        }
    }

    val uiState: StateFlow<DeckEditorUiState> = combine(
        workspaceRepository.observeWorkspaceTagsSummary(),
        inputState
    ) { tagsSummary, currentState ->
        toDeckEditorUiState(
            inputState = currentState,
            availableTags = tagsSummary.tags,
            editingDeckId = editingDeckId,
            strings = strings
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = toDeckEditorUiState(
            inputState = inputState.value,
            availableTags = emptyList(),
            editingDeckId = editingDeckId,
            strings = strings
        )
    )

    fun updateName(name: String) {
        inputState.update { state ->
            state.copy(name = name, errorMessage = "")
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
        val state = inputState.value
        val trimmedName = state.name.trim()

        if (state.isSubmitting || state.isEditingDeckMissing ||
            isDeckEditorLoading(inputState = state, editingDeckId = editingDeckId)
        ) {
            return null
        }

        if (trimmedName.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = strings.get(R.string.settings_deck_editor_name_required))
            }
            return null
        }

        if (isDeckFilterEmpty(selectedTags = state.selectedTags)) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = strings.get(R.string.settings_deck_editor_filter_required))
            }
            return null
        }

        val deckDraft = DeckDraft(
            name = trimmedName,
            filterDefinition = buildDeckFilterDefinition(
                tags = state.selectedTags
            )
        )

        if (!submissionMutex.tryLock()) {
            return null
        }
        inputState.update { currentState -> currentState.copy(isSubmitting = true, errorMessage = "") }
        try {
            return if (editingDeckId == null) {
                DeckEditorSaveResult.Created(
                    deckId = decksRepository.createDeck(deckDraft = deckDraft)
                )
            } else {
                decksRepository.updateDeck(deckId = editingDeckId, deckDraft = deckDraft)
                DeckEditorSaveResult.Updated
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            reportSubmissionError(
                error = error,
                message = strings.get(R.string.settings_deck_editor_save_failed)
            )
            return null
        } finally {
            inputState.update { currentState -> currentState.copy(isSubmitting = false) }
            submissionMutex.unlock()
        }
    }

    suspend fun delete(editingDeckId: String): Boolean {
        val state = inputState.value
        if (this.editingDeckId != editingDeckId || state.loadedEditingDeckId != editingDeckId ||
            state.isEditingDeckMissing || !submissionMutex.tryLock()
        ) {
            return false
        }
        inputState.update { currentState -> currentState.copy(isSubmitting = true, errorMessage = "") }
        try {
            decksRepository.deleteDeck(deckId = editingDeckId)
            return true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            reportSubmissionError(
                error = error,
                message = strings.get(R.string.settings_deck_editor_delete_failed)
            )
            return false
        } finally {
            inputState.update { currentState -> currentState.copy(isSubmitting = false) }
            submissionMutex.unlock()
        }
    }

    private fun reportSubmissionError(error: Exception, message: String) {
        inputState.update { currentState -> currentState.copy(errorMessage = message) }
        technicalErrorController.showTechnicalError(
            error = makeAppTechnicalError(
                title = strings.get(R.string.settings_technical_error_title),
                message = message,
                throwable = error
            ),
            throwable = error
        )
    }
}

fun createDeckEditorViewModelFactory(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    editingDeckId: String?,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckEditorViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository,
                editingDeckId = editingDeckId,
                technicalErrorController = technicalErrorController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

private fun toggleTagSelection(selectedTags: List<String>, tag: String): List<String> {
    if (selectedTags.contains(tag)) {
        return selectedTags.filter { value ->
            value != tag
        }
    }

    return selectedTags + tag
}

private fun isDeckFilterEmpty(selectedTags: List<String>): Boolean {
    return selectedTags.isEmpty()
}

private data class DeckEditorInputState(
    val name: String,
    val selectedTags: List<String>,
    val errorMessage: String,
    val loadedEditingDeckId: String?,
    val persistedDeckName: String?,
    val isSubmitting: Boolean,
    val isEditingDeckMissing: Boolean
)

private fun applyObservedEditingDeck(
    currentState: DeckEditorInputState,
    deck: DeckSummary?
): DeckEditorInputState {
    if (deck == null) {
        return currentState.copy(isEditingDeckMissing = true, persistedDeckName = null)
    }

    if (currentState.loadedEditingDeckId == deck.deckId) {
        return currentState.copy(isEditingDeckMissing = false, persistedDeckName = deck.name)
    }

    return currentState.copy(
        name = deck.name,
        selectedTags = deck.filterDefinition.tags,
        loadedEditingDeckId = deck.deckId,
        persistedDeckName = deck.name,
        isEditingDeckMissing = false
    )
}

private fun toDeckEditorUiState(
    inputState: DeckEditorInputState,
    availableTags: List<WorkspaceTagSummary>,
    editingDeckId: String?,
    strings: SettingsStringResolver
): DeckEditorUiState {
    return DeckEditorUiState(
        isLoading = isDeckEditorLoading(
            inputState = inputState,
            editingDeckId = editingDeckId
        ),
        isDeckMissing = inputState.isEditingDeckMissing,
        isSubmitting = inputState.isSubmitting,
        deleteTarget = if (inputState.loadedEditingDeckId != null && inputState.persistedDeckName != null &&
            !inputState.isEditingDeckMissing
        ) {
            DeckEditorDeleteTarget(
                deckId = inputState.loadedEditingDeckId,
                name = inputState.persistedDeckName
            )
        } else {
            null
        },
        title = if (editingDeckId == null) {
            strings.get(R.string.settings_deck_editor_new_title)
        } else {
            strings.get(R.string.settings_deck_editor_edit_title)
        },
        isEditing = editingDeckId != null,
        name = inputState.name,
        selectedTags = inputState.selectedTags,
        availableTags = availableTags,
        errorMessage = inputState.errorMessage
    )
}

private fun isDeckEditorLoading(
    inputState: DeckEditorInputState,
    editingDeckId: String?
): Boolean {
    return editingDeckId != null &&
        inputState.loadedEditingDeckId == null &&
        inputState.isEditingDeckMissing.not()
}
