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
    val frontTextSelection: CardEditorTextSelection,
    val backTextSelection: CardEditorTextSelection,
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
            frontTextSelection = CardEditorTextSelection(start = 0, end = 0),
            backTextSelection = CardEditorTextSelection(start = 0, end = 0),
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
                frontTextSelection = clampCardEditorTextSelection(
                    selection = currentState.frontTextSelection,
                    text = currentState.frontText
                ),
                backTextSelection = clampCardEditorTextSelection(
                    selection = currentState.backTextSelection,
                    text = currentState.backText
                ),
                frontManagedImageReferences = parseManagedImageReferences(text = currentState.frontText),
                backManagedImageReferences = parseManagedImageReferences(text = currentState.backText),
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
                frontTextSelection = CardEditorTextSelection(start = 0, end = 0),
                backTextSelection = CardEditorTextSelection(start = 0, end = 0),
                frontManagedImageReferences = emptyList(),
                backManagedImageReferences = emptyList(),
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

    fun updateFrontText(
        frontText: String,
        selection: CardEditorTextSelection
    ) {
        inputState.update { state ->
            state.copy(
                frontText = frontText,
                frontTextSelection = clampCardEditorTextSelection(
                    selection = selection,
                    text = frontText
                ),
                frontTextErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun updateBackText(
        backText: String,
        selection: CardEditorTextSelection
    ) {
        inputState.update { state ->
            state.copy(
                backText = backText,
                backTextSelection = clampCardEditorTextSelection(
                    selection = selection,
                    text = backText
                ),
                backTextErrorMessage = "",
                errorMessage = "",
                isDirty = true
            )
        }
    }

    fun updateFrontTextSelection(selection: CardEditorTextSelection) {
        inputState.update { state ->
            state.copy(
                frontTextSelection = clampCardEditorTextSelection(
                    selection = selection,
                    text = state.frontText
                )
            )
        }
    }

    fun updateBackTextSelection(selection: CardEditorTextSelection) {
        inputState.update { state ->
            state.copy(
                backTextSelection = clampCardEditorTextSelection(
                    selection = selection,
                    text = state.backText
                )
            )
        }
    }

    fun insertManagedImageMarkdown(
        field: CardEditorTextField,
        markdown: String
    ) {
        val normalizedMarkdown = markdown.trim()
        require(normalizedMarkdown.isNotBlank()) {
            "Managed image markdown must not be blank."
        }

        inputState.update { state ->
            when (field) {
                CardEditorTextField.FRONT -> {
                    val edit = insertMarkdownAtSelection(
                        text = state.frontText,
                        selection = state.frontTextSelection,
                        markdown = normalizedMarkdown
                    )
                    state.copy(
                        frontText = edit.text,
                        frontTextSelection = edit.selection,
                        frontTextErrorMessage = "",
                        errorMessage = "",
                        isDirty = true
                    )
                }

                CardEditorTextField.BACK -> {
                    val edit = insertMarkdownAtSelection(
                        text = state.backText,
                        selection = state.backTextSelection,
                        markdown = normalizedMarkdown
                    )
                    state.copy(
                        backText = edit.text,
                        backTextSelection = edit.selection,
                        backTextErrorMessage = "",
                        errorMessage = "",
                        isDirty = true
                    )
                }
            }
        }
    }

    fun removeManagedImageReference(
        field: CardEditorTextField,
        referenceKey: String
    ) {
        require(referenceKey.isNotBlank()) {
            "Managed image reference key must not be blank."
        }

        inputState.update { state ->
            when (field) {
                CardEditorTextField.FRONT -> {
                    val edit = removeManagedImageReferenceFromText(
                        text = state.frontText,
                        selection = state.frontTextSelection,
                        referenceKey = referenceKey
                    ) ?: return@update state.copy(
                        errorMessage = textProvider.imageReferenceMissing
                    )
                    state.copy(
                        frontText = edit.text,
                        frontTextSelection = edit.selection,
                        frontTextErrorMessage = "",
                        errorMessage = "",
                        isDirty = true
                    )
                }

                CardEditorTextField.BACK -> {
                    val edit = removeManagedImageReferenceFromText(
                        text = state.backText,
                        selection = state.backTextSelection,
                        referenceKey = referenceKey
                    ) ?: return@update state.copy(
                        errorMessage = textProvider.imageReferenceMissing
                    )
                    state.copy(
                        backText = edit.text,
                        backTextSelection = edit.selection,
                        backTextErrorMessage = "",
                        errorMessage = "",
                        isDirty = true
                    )
                }
            }
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

private data class CardEditorTextEditResult(
    val text: String,
    val selection: CardEditorTextSelection
)

private data class ManagedImageReferenceMatch(
    val reference: CardEditorManagedImageReference,
    val startIndex: Int,
    val endIndexExclusive: Int
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

private val managedImageMarkdownRegex = Regex("""!\[([^\]\n]*)]\(fcasset:([^\s)]+)\)""")

private fun insertMarkdownAtSelection(
    text: String,
    selection: CardEditorTextSelection,
    markdown: String
): CardEditorTextEditResult {
    val normalizedSelection = clampCardEditorTextSelection(selection = selection, text = text)
    val prefix = if (text.substring(startIndex = 0, endIndex = normalizedSelection.start).endsWith("\n") ||
        normalizedSelection.start == 0
    ) {
        ""
    } else {
        "\n\n"
    }
    val suffix = if (text.substring(startIndex = normalizedSelection.end).startsWith("\n") ||
        normalizedSelection.end == text.length
    ) {
        ""
    } else {
        "\n\n"
    }
    val insertedMarkdown = "$prefix$markdown$suffix"
    val updatedText = text.replaceRange(
        startIndex = normalizedSelection.start,
        endIndex = normalizedSelection.end,
        replacement = insertedMarkdown
    )
    val cursorIndex = normalizedSelection.start + insertedMarkdown.length
    return CardEditorTextEditResult(
        text = updatedText,
        selection = CardEditorTextSelection(start = cursorIndex, end = cursorIndex)
    )
}

private fun removeManagedImageReferenceFromText(
    text: String,
    selection: CardEditorTextSelection,
    referenceKey: String
): CardEditorTextEditResult? {
    val match = findManagedImageReferenceMatches(text = text).firstOrNull { currentMatch ->
        currentMatch.reference.referenceKey == referenceKey
    } ?: return null
    val updatedText = text.removeRange(
        startIndex = match.startIndex,
        endIndex = match.endIndexExclusive
    )
    return CardEditorTextEditResult(
        text = updatedText,
        selection = shiftSelectionAfterRemoval(
            selection = selection,
            removedStartIndex = match.startIndex,
            removedEndIndexExclusive = match.endIndexExclusive
        )
    )
}

private fun parseManagedImageReferences(text: String): List<CardEditorManagedImageReference> {
    return findManagedImageReferenceMatches(text = text).map(ManagedImageReferenceMatch::reference)
}

private fun findManagedImageReferenceMatches(text: String): List<ManagedImageReferenceMatch> {
    return managedImageMarkdownRegex.findAll(input = text).map { match ->
        val startIndex = match.range.first
        val endIndexExclusive = match.range.last + 1
        val rawLabel = match.groupValues[1].trim()
        val label = if (rawLabel.isEmpty()) null else rawLabel
        val mediaAssetId = match.groupValues[2].trim()
        ManagedImageReferenceMatch(
            reference = CardEditorManagedImageReference(
                referenceKey = "$startIndex:$endIndexExclusive:$mediaAssetId",
                mediaAssetId = mediaAssetId,
                label = label
            ),
            startIndex = startIndex,
            endIndexExclusive = endIndexExclusive
        )
    }.toList()
}

private fun clampCardEditorTextSelection(
    selection: CardEditorTextSelection,
    text: String
): CardEditorTextSelection {
    val start = selection.start.coerceIn(minimumValue = 0, maximumValue = text.length)
    val end = selection.end.coerceIn(minimumValue = 0, maximumValue = text.length)
    val normalizedStart = minOf(start, end)
    val normalizedEnd = maxOf(start, end)
    return CardEditorTextSelection(start = normalizedStart, end = normalizedEnd)
}

private fun shiftSelectionAfterRemoval(
    selection: CardEditorTextSelection,
    removedStartIndex: Int,
    removedEndIndexExclusive: Int
): CardEditorTextSelection {
    val removedLength = removedEndIndexExclusive - removedStartIndex
    val shiftedStart = shiftTextOffsetAfterRemoval(
        offset = selection.start,
        removedStartIndex = removedStartIndex,
        removedEndIndexExclusive = removedEndIndexExclusive,
        removedLength = removedLength
    )
    val shiftedEnd = shiftTextOffsetAfterRemoval(
        offset = selection.end,
        removedStartIndex = removedStartIndex,
        removedEndIndexExclusive = removedEndIndexExclusive,
        removedLength = removedLength
    )
    return CardEditorTextSelection(
        start = minOf(shiftedStart, shiftedEnd),
        end = maxOf(shiftedStart, shiftedEnd)
    )
}

private fun shiftTextOffsetAfterRemoval(
    offset: Int,
    removedStartIndex: Int,
    removedEndIndexExclusive: Int,
    removedLength: Int
): Int {
    return when {
        offset <= removedStartIndex -> offset
        offset >= removedEndIndexExclusive -> offset - removedLength
        else -> removedStartIndex
    }
}
