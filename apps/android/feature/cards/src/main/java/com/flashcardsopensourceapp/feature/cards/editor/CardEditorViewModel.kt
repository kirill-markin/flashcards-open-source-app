package com.flashcardsopensourceapp.feature.cards.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.cards.CardsTextProvider
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class CardEditorDraftState(
    val frontText: String,
    val backText: String,
    val selectedTags: List<String>,
    val frontTextErrorMessage: String,
    val backTextErrorMessage: String,
    val tagsErrorMessage: String,
    val errorMessage: String,
    val isDirty: Boolean,
    val hasLoadedInitialValues: Boolean
)

class CardEditorViewModel(
    private val cardsRepository: CardsRepository,
    private val workspaceRepository: WorkspaceRepository,
    editingCardId: String?,
    private val textProvider: CardsTextProvider
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = CardEditorDraftState(
            frontText = "",
            backText = "",
            selectedTags = emptyList(),
            frontTextErrorMessage = "",
            backTextErrorMessage = "",
            tagsErrorMessage = "",
            errorMessage = "",
            isDirty = false,
            hasLoadedInitialValues = editingCardId == null
        )
    )

    val uiState: StateFlow<CardEditorUiState>

    init {
        val cardFlow: Flow<CardSummary?> = if (editingCardId == null) {
            flowOf(null)
        } else {
            cardsRepository.observeCard(cardId = editingCardId)
        }

        viewModelScope.launch {
            cardFlow.collect { card ->
                if (card == null || inputState.value.hasLoadedInitialValues) {
                    return@collect
                }

                inputState.update { state ->
                    state.copy(
                        frontText = card.frontText,
                        backText = card.backText,
                        selectedTags = card.tags,
                        hasLoadedInitialValues = true
                    )
                }
            }
        }

        uiState = combine(
            cardFlow,
            workspaceRepository.observeWorkspaceTagsSummary(),
            inputState
        ) { card, tagsSummary, currentState ->
            CardEditorUiState(
                isLoading = editingCardId != null && card != null && currentState.hasLoadedInitialValues.not(),
                title = if (editingCardId == null) textProvider.newCardTitle else textProvider.editCardTitle,
                isEditing = editingCardId != null,
                frontText = currentState.frontText,
                backText = currentState.backText,
                selectedTags = normalizeTags(
                    values = currentState.selectedTags,
                    referenceTags = tagsSummary.tags.map(WorkspaceTagSummary::tag)
                ),
                availableTagSuggestions = tagsSummary.tags,
                frontTextErrorMessage = currentState.frontTextErrorMessage,
                backTextErrorMessage = currentState.backTextErrorMessage,
                tagsErrorMessage = currentState.tagsErrorMessage,
                errorMessage = currentState.errorMessage,
                isDirty = currentState.isDirty
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
            initialValue = CardEditorUiState(
                isLoading = true,
                title = if (editingCardId == null) textProvider.newCardTitle else textProvider.editCardTitle,
                isEditing = editingCardId != null,
                frontText = "",
                backText = "",
                selectedTags = emptyList(),
                availableTagSuggestions = emptyList(),
                frontTextErrorMessage = "",
                backTextErrorMessage = "",
                tagsErrorMessage = "",
                errorMessage = "",
                isDirty = false
            )
        )
    }

    fun updateFrontText(frontText: String) {
        inputState.update { state ->
            state.copy(
                frontText = frontText,
                frontTextErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun updateBackText(backText: String) {
        inputState.update { state ->
            state.copy(
                backText = backText,
                backTextErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun toggleTag(tag: String) {
        val referenceTags = currentReferenceTags()
        inputState.update { state ->
            state.copy(
                selectedTags = normalizeTags(
                    values = toggleTagSelection(
                        selectedTags = state.selectedTags,
                        tag = tag
                    ),
                    referenceTags = referenceTags
                ),
                tagsErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun addTag(rawValue: String) {
        val referenceTags = currentReferenceTags()
        val normalizedTag = normalizeTags(
            values = listOf(rawValue),
            referenceTags = referenceTags + uiState.value.selectedTags
        ).firstOrNull()

        if (normalizedTag == null) {
            inputState.update { state ->
                state.copy(
                    tagsErrorMessage = textProvider.enterTagBeforeAdding,
                    errorMessage = "",
                    isDirty = true
                )
            }
            return
        }

        inputState.update { state ->
            state.copy(
                selectedTags = normalizeTags(
                    values = state.selectedTags + normalizedTag,
                    referenceTags = referenceTags
                ),
                tagsErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun removeTag(tag: String) {
        inputState.update { state ->
            state.copy(
                selectedTags = state.selectedTags.filter { value ->
                    value != tag
                },
                tagsErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    suspend fun save(editingCardId: String?): CardDraft? {
        val state = uiState.value
        val validation = validateCardEditorInput(
            frontText = state.frontText,
            backText = state.backText,
            textProvider = textProvider
        )

        if (validation.isValid.not()) {
            inputState.update { currentState ->
                currentState.copy(
                    frontTextErrorMessage = validation.frontTextErrorMessage,
                    backTextErrorMessage = validation.backTextErrorMessage,
                    errorMessage = validation.errorMessage
                )
            }
            return null
        }

        val cardDraft = buildCardEditorDraft(
            frontText = state.frontText,
            backText = state.backText,
            selectedTags = state.selectedTags,
            referenceTags = currentReferenceTags()
        )

        return if (editingCardId == null) {
            cardsRepository.createCard(cardDraft = cardDraft)
            inputState.update { currentState ->
                currentState.copy(
                    frontTextErrorMessage = "",
                    backTextErrorMessage = "",
                    tagsErrorMessage = "",
                    errorMessage = "",
                    isDirty = false
                )
            }
            cardDraft
        } else {
            cardsRepository.updateCard(cardId = editingCardId, cardDraft = cardDraft)
            inputState.update { currentState ->
                currentState.copy(
                    frontTextErrorMessage = "",
                    backTextErrorMessage = "",
                    tagsErrorMessage = "",
                    errorMessage = "",
                    isDirty = false
                )
            }
            cardDraft
        }
    }

    suspend fun delete(editingCardId: String): Boolean {
        cardsRepository.deleteCard(cardId = editingCardId)
        return true
    }

    private fun currentReferenceTags(): List<String> {
        return uiState.value.availableTagSuggestions.map(WorkspaceTagSummary::tag)
    }
}

private data class CardEditorValidationResult(
    val isValid: Boolean,
    val frontTextErrorMessage: String,
    val backTextErrorMessage: String,
    val errorMessage: String
)

private fun validateCardEditorInput(
    frontText: String,
    backText: String,
    textProvider: CardsTextProvider
): CardEditorValidationResult {
    val frontTextErrorMessage = if (frontText.trim().isEmpty()) {
        textProvider.frontTextRequired
    } else {
        ""
    }
    val backTextErrorMessage = if (backText.trim().isEmpty()) {
        textProvider.backTextRequired
    } else {
        ""
    }

    return CardEditorValidationResult(
        isValid = frontTextErrorMessage.isEmpty() && backTextErrorMessage.isEmpty(),
        frontTextErrorMessage = frontTextErrorMessage,
        backTextErrorMessage = backTextErrorMessage,
        errorMessage = frontTextErrorMessage.ifEmpty { backTextErrorMessage }
    )
}

private fun toggleTagSelection(selectedTags: List<String>, tag: String): List<String> {
    if (selectedTags.contains(tag)) {
        return selectedTags.filter { value ->
            value != tag
        }
    }

    return selectedTags + tag
}
