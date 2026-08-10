package com.flashcardsopensourceapp.feature.cards.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import com.flashcardsopensourceapp.data.local.model.media.ManagedMediaReference
import com.flashcardsopensourceapp.data.local.model.media.ManagedMediaReferenceState
import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.cards.CardsTextProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
    val hasLoadedInitialValues: Boolean,
    val isCardUnavailable: Boolean,
    val schedulingMetadata: CardEditorSchedulingMetadata?
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
            hasLoadedInitialValues = editingCardId == null,
            isCardUnavailable = false,
            schedulingMetadata = null
        )
    )

    val uiState: StateFlow<CardEditorUiState>

    init {
        if (editingCardId != null) {
            viewModelScope.launch {
                var previousObservedCard: CardSummary? = null
                cardsRepository.observeCard(cardId = editingCardId).collect { card ->
                    if (
                        card == null ||
                        (card.deletedAtMillis != null && inputState.value.hasLoadedInitialValues.not())
                    ) {
                        inputState.update { state ->
                            if (state.hasLoadedInitialValues) {
                                state
                            } else {
                                state.copy(
                                    errorMessage = textProvider.cardUnavailable,
                                    hasLoadedInitialValues = true,
                                    isCardUnavailable = true
                                )
                            }
                        }
                        return@collect
                    }

                    val previousCard: CardSummary? = previousObservedCard
                    inputState.update { state ->
                        if (state.hasLoadedInitialValues && previousCard != null) {
                            val refreshedFrontText = refreshManagedImageReferenceStates(
                                text = state.frontText,
                                selection = state.frontTextSelection,
                                previousObservedText = previousCard.frontText,
                                observedText = card.frontText
                            )
                            val refreshedBackText = refreshManagedImageReferenceStates(
                                text = state.backText,
                                selection = state.backTextSelection,
                                previousObservedText = previousCard.backText,
                                observedText = card.backText
                            )
                            return@update state.copy(
                                frontText = refreshedFrontText.text,
                                backText = refreshedBackText.text,
                                frontTextSelection = refreshedFrontText.selection,
                                backTextSelection = refreshedBackText.selection
                            )
                        }
                        if (state.hasLoadedInitialValues) {
                            return@update state
                        }

                        state.copy(
                            frontText = card.frontText,
                            backText = card.backText,
                            selectedTags = card.tags,
                            hasLoadedInitialValues = true,
                            schedulingMetadata = CardEditorSchedulingMetadata(
                                dueAtMillis = card.dueAtMillis,
                                reps = card.reps,
                                lapses = card.lapses
                            )
                        )
                    }
                    previousObservedCard = card
                }
            }
        }

        uiState = combine(
            workspaceRepository.observeWorkspaceTagsSummary(),
            inputState
        ) { tagsSummary, currentState ->
            CardEditorUiState(
                isLoading = currentState.hasLoadedInitialValues.not(),
                isCardUnavailable = currentState.isCardUnavailable,
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
                schedulingMetadata = currentState.schedulingMetadata,
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
                isLoading = editingCardId != null,
                isCardUnavailable = false,
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
                schedulingMetadata = null,
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

private data class ManagedImageReferenceIdentity(
    val mediaAssetId: String,
    val markdownWithoutDestination: String
)

private data class ManagedImageReferenceMatch(
    val reference: CardEditorManagedImageReference,
    val identity: ManagedImageReferenceIdentity,
    val startIndex: Int,
    val endIndexExclusive: Int,
    val destination: String,
    val destinationRange: IntRange
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

private val managedImageMarkdownRegex = Regex("""!\[([^\]\n]*)]\((fcasset:[^\s)]+)\)""")

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
    return managedImageMarkdownRegex.findAll(input = text).mapNotNull { match ->
        val startIndex = match.range.first
        val endIndexExclusive = match.range.last + 1
        val rawLabel = match.groupValues[1].trim()
        val label = if (rawLabel.isEmpty()) null else rawLabel
        val destinationGroup: MatchGroup = match.groups[2] ?: return@mapNotNull null
        val parsedReference: ManagedMediaReference = parseManagedMediaReference(
            reference = destinationGroup.value
        ) ?: return@mapNotNull null
        ManagedImageReferenceMatch(
            reference = CardEditorManagedImageReference(
                referenceKey = "$startIndex:$endIndexExclusive:${parsedReference.mediaAssetId}",
                mediaAssetId = parsedReference.mediaAssetId,
                state = parsedReference.state,
                label = label
            ),
            identity = ManagedImageReferenceIdentity(
                mediaAssetId = parsedReference.mediaAssetId,
                markdownWithoutDestination = text.substring(
                    startIndex = startIndex,
                    endIndex = destinationGroup.range.first
                ) + text.substring(
                    startIndex = destinationGroup.range.last + 1,
                    endIndex = endIndexExclusive
                )
            ),
            startIndex = startIndex,
            endIndexExclusive = endIndexExclusive,
            destination = destinationGroup.value,
            destinationRange = destinationGroup.range
        )
    }.toList()
}

private fun refreshManagedImageReferenceStates(
    text: String,
    selection: CardEditorTextSelection,
    previousObservedText: String,
    observedText: String
): CardEditorTextEditResult {
    val replacements: List<Pair<ManagedImageReferenceMatch, String>> =
        managedImageReferenceReplacements(
            previousObservedText = previousObservedText,
            currentText = text,
            observedText = observedText
        ).sortedBy { (match, _) ->
            match.destinationRange.first
        }

    var refreshedText: String = text
    var refreshedSelection: CardEditorTextSelection = selection
    replacements.asReversed().forEach { (match, replacement) ->
        refreshedText = refreshedText.replaceRange(
            range = match.destinationRange,
            replacement = replacement
        )
        refreshedSelection = shiftSelectionAfterReplacement(
            selection = refreshedSelection,
            replacedStartIndex = match.destinationRange.first,
            replacedEndIndexExclusive = match.destinationRange.last + 1,
            replacementLength = replacement.length
        )
    }

    return CardEditorTextEditResult(
        text = refreshedText,
        selection = clampCardEditorTextSelection(
            selection = refreshedSelection,
            text = refreshedText
        )
    )
}

private fun managedImageReferenceReplacements(
    previousObservedText: String,
    currentText: String,
    observedText: String
): List<Pair<ManagedImageReferenceMatch, String>> {
    val previousMatchesByIdentity:
        Map<ManagedImageReferenceIdentity, List<ManagedImageReferenceMatch>> =
        findManagedImageReferenceMatches(text = previousObservedText).groupBy { match ->
            match.identity
        }
    val currentMatchesByIdentity:
        Map<ManagedImageReferenceIdentity, List<ManagedImageReferenceMatch>> =
        findManagedImageReferenceMatches(text = currentText).groupBy { match ->
            match.identity
        }
    val observedMatchesByIdentity:
        Map<ManagedImageReferenceIdentity, List<ManagedImageReferenceMatch>> =
        findManagedImageReferenceMatches(text = observedText).groupBy { match ->
            match.identity
        }

    return previousMatchesByIdentity.flatMap { (identity, previousMatches) ->
        val currentMatches: List<ManagedImageReferenceMatch> = currentMatchesByIdentity[
            identity
        ] ?: return@flatMap emptyList()
        val observedMatches: List<ManagedImageReferenceMatch> = observedMatchesByIdentity[
            identity
        ] ?: return@flatMap emptyList()
        if (currentMatches.size != previousMatches.size ||
            observedMatches.size != previousMatches.size
        ) {
            return@flatMap emptyList()
        }

        if (previousMatches.size == 1) {
            val previousMatch: ManagedImageReferenceMatch = previousMatches.single()
            val currentMatch: ManagedImageReferenceMatch = currentMatches.single()
            val observedMatch: ManagedImageReferenceMatch = observedMatches.single()
            if (previousMatch.reference.state == ManagedMediaReferenceState.READY ||
                currentMatch.destination != previousMatch.destination ||
                previousMatch.destination == observedMatch.destination
            ) {
                return@flatMap emptyList()
            }
            return@flatMap listOf(currentMatch to observedMatch.destination)
        }

        duplicateManagedImageReferenceReplacements(
            previousMatches = previousMatches,
            currentMatches = currentMatches,
            observedMatches = observedMatches
        )
    }
}

private fun duplicateManagedImageReferenceReplacements(
    previousMatches: List<ManagedImageReferenceMatch>,
    currentMatches: List<ManagedImageReferenceMatch>,
    observedMatches: List<ManagedImageReferenceMatch>
): List<Pair<ManagedImageReferenceMatch, String>> {
    val previousDestinationCounts: Map<String, Int> =
        previousMatches.groupingBy(ManagedImageReferenceMatch::destination).eachCount()
    val currentDestinationCounts: Map<String, Int> =
        currentMatches.groupingBy(ManagedImageReferenceMatch::destination).eachCount()
    if (currentDestinationCounts != previousDestinationCounts) {
        return emptyList()
    }

    val observedDestination: String = observedMatches
        .map(ManagedImageReferenceMatch::destination)
        .distinct()
        .singleOrNull()
        ?: return emptyList()
    val eligiblePreviousDestinations: Set<String> = previousMatches
        .filter { match ->
            match.reference.state != ManagedMediaReferenceState.READY &&
                match.destination != observedDestination
        }
        .mapTo(destination = mutableSetOf(), transform = ManagedImageReferenceMatch::destination)
    return currentMatches.mapNotNull { currentMatch ->
        if (currentMatch.destination in eligiblePreviousDestinations) {
            currentMatch to observedDestination
        } else {
            null
        }
    }
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

private fun shiftSelectionAfterReplacement(
    selection: CardEditorTextSelection,
    replacedStartIndex: Int,
    replacedEndIndexExclusive: Int,
    replacementLength: Int
): CardEditorTextSelection {
    val shiftedStart: Int = shiftTextOffsetAfterReplacement(
        offset = selection.start,
        replacedStartIndex = replacedStartIndex,
        replacedEndIndexExclusive = replacedEndIndexExclusive,
        replacementLength = replacementLength
    )
    val shiftedEnd: Int = shiftTextOffsetAfterReplacement(
        offset = selection.end,
        replacedStartIndex = replacedStartIndex,
        replacedEndIndexExclusive = replacedEndIndexExclusive,
        replacementLength = replacementLength
    )
    return CardEditorTextSelection(
        start = minOf(shiftedStart, shiftedEnd),
        end = maxOf(shiftedStart, shiftedEnd)
    )
}

private fun shiftTextOffsetAfterReplacement(
    offset: Int,
    replacedStartIndex: Int,
    replacedEndIndexExclusive: Int,
    replacementLength: Int
): Int {
    val replacedLength: Int = replacedEndIndexExclusive - replacedStartIndex
    return when {
        offset <= replacedStartIndex -> offset
        offset >= replacedEndIndexExclusive -> offset + replacementLength - replacedLength
        else -> replacedStartIndex + minOf(offset - replacedStartIndex, replacementLength)
    }
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
