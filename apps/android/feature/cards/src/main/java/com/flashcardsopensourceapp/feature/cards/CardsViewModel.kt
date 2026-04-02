package com.flashcardsopensourceapp.feature.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
class CardsViewModel(
    private val cardsRepository: CardsRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")
    private val activeFilter = MutableStateFlow(
        value = CardFilter(
            tags = emptyList(),
            effort = emptyList()
        )
    )

    private val cardsFlow = combine(
        searchQuery,
        activeFilter
    ) { query, filter ->
        query to filter
    }.flatMapLatest { (query, filter) ->
        cardsRepository.observeCards(
            searchQuery = query,
            filter = filter
        )
    }
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private var pendingAutoSyncRequestId: String? = null
    private var cardsSignatureAtAutoSyncStart: CardsVisibleSignature? = null
    private var lastVisibleAutoSyncChangeSignature: CardsVisibleSignature? = null

    val uiState: StateFlow<CardsUiState> = combine(
        cardsFlow,
        workspaceRepository.observeWorkspaceTagsSummary(),
        searchQuery,
        activeFilter
    ) { cards, tagsSummary, query, filter ->
        CardsUiState(
            isLoading = false,
            searchQuery = query,
            activeFilter = filter,
            availableTagSuggestions = tagsSummary.tags,
            cards = cards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CardsUiState(
            isLoading = true,
            searchQuery = "",
            activeFilter = CardFilter(tags = emptyList(), effort = emptyList()),
            availableTagSuggestions = emptyList(),
            cards = emptyList()
        )
    )

    init {
        observeAutoSyncDrivenCardsChanges()
    }

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun applyFilter(filter: CardFilter) {
        activeFilter.value = filter
    }

    fun clearFilter() {
        activeFilter.value = CardFilter(
            tags = emptyList(),
            effort = emptyList()
        )
    }

    private fun observeAutoSyncDrivenCardsChanges() {
        viewModelScope.launch {
            autoSyncEventRepository.observeAutoSyncEvents().collect { event ->
                when (event) {
                    is AutoSyncEvent.Requested -> {
                        handleAutoSyncRequested(request = event.request)
                    }

                    is AutoSyncEvent.Completed -> {
                        handleAutoSyncCompleted(completion = event.completion)
                    }
                }
            }
        }
    }

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.CARDS) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        cardsSignatureAtAutoSyncStart = buildCardsVisibleSignature(uiState = uiState.value)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val cardsSignatureBeforeSync = cardsSignatureAtAutoSyncStart
        cardsSignatureAtAutoSyncStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.CARDS) {
            return
        }

        val currentCardsSignature = buildCardsVisibleSignature(uiState = uiState.value)
        if (cardsSignatureBeforeSync == null || cardsSignatureBeforeSync == currentCardsSignature) {
            return
        }
        if (currentCardsSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        lastVisibleAutoSyncChangeSignature = currentCardsSignature
        messageController.showMessage(message = cardsUpdatedOnAnotherDeviceMessage)
    }
}

private data class VisibleCardSignature(
    val cardId: String,
    val frontText: String,
    val effortLevel: EffortLevel,
    val tags: List<String>,
    val dueAtMillis: Long?
)

private data class CardsVisibleSignature(
    val searchQuery: String,
    val activeFilter: CardFilter,
    val cards: List<VisibleCardSignature>
)

private const val cardsUpdatedOnAnotherDeviceMessage: String = "Cards updated on another device."

private fun buildCardsVisibleSignature(uiState: CardsUiState): CardsVisibleSignature {
    return CardsVisibleSignature(
        searchQuery = uiState.searchQuery,
        activeFilter = uiState.activeFilter,
        cards = uiState.cards.map { card ->
            VisibleCardSignature(
                cardId = card.cardId,
                frontText = card.frontText,
                effortLevel = card.effortLevel,
                tags = card.tags,
                dueAtMillis = card.dueAtMillis
            )
        }
    )
}

private data class CardEditorDraftState(
    val frontText: String,
    val backText: String,
    val selectedTags: List<String>,
    val effortLevel: EffortLevel,
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
    editingCardId: String?
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = CardEditorDraftState(
            frontText = "",
            backText = "",
            selectedTags = emptyList(),
            effortLevel = EffortLevel.FAST,
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
                        effortLevel = card.effortLevel,
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
                title = if (editingCardId == null) "New card" else "Edit card",
                isEditing = editingCardId != null,
                frontText = currentState.frontText,
                backText = currentState.backText,
                selectedTags = normalizeTags(
                    values = currentState.selectedTags,
                    referenceTags = tagsSummary.tags.map(WorkspaceTagSummary::tag)
                ),
                availableTagSuggestions = tagsSummary.tags,
                effortLevel = currentState.effortLevel,
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
                title = if (editingCardId == null) "New card" else "Edit card",
                isEditing = editingCardId != null,
                frontText = "",
                backText = "",
                selectedTags = emptyList(),
                availableTagSuggestions = emptyList(),
                effortLevel = EffortLevel.FAST,
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
                    tagsErrorMessage = "Enter a tag before adding it.",
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

    fun updateEffortLevel(effortLevel: EffortLevel) {
        inputState.update { state ->
            state.copy(
                effortLevel = effortLevel,
                errorMessage = "",
                isDirty = true
            )
        }
    }

    suspend fun save(editingCardId: String?): Boolean {
        val state = uiState.value
        val validation = validateCardEditorInput(
            frontText = state.frontText,
            backText = state.backText
        )

        if (validation.isValid.not()) {
            inputState.update { currentState ->
                currentState.copy(
                    frontTextErrorMessage = validation.frontTextErrorMessage,
                    backTextErrorMessage = validation.backTextErrorMessage,
                    errorMessage = validation.errorMessage
                )
            }
            return false
        }

        val cardDraft = CardDraft(
            frontText = state.frontText.trim(),
            backText = state.backText.trim(),
            tags = normalizeTags(
                values = state.selectedTags,
                referenceTags = currentReferenceTags()
            ),
            effortLevel = state.effortLevel
        )

        return if (editingCardId == null) {
            cardsRepository.createCard(cardDraft = cardDraft)
            true
        } else {
            cardsRepository.updateCard(cardId = editingCardId, cardDraft = cardDraft)
            true
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

fun createCardsViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardsViewModel(
                cardsRepository = cardsRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

fun createCardEditorViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    editingCardId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardEditorViewModel(
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                editingCardId = editingCardId
            )
        }
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
    backText: String
): CardEditorValidationResult {
    val frontTextErrorMessage = if (frontText.trim().isEmpty()) {
        "Front text is required."
    } else {
        ""
    }
    val backTextErrorMessage = if (backText.trim().isEmpty()) {
        "Back text is required."
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
