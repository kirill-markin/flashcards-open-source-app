package com.flashcardsopensourceapp.feature.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.ExperimentalCoroutinesApi

@OptIn(ExperimentalCoroutinesApi::class)
class CardsViewModel(
    private val cardsRepository: CardsRepository,
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
}

class CardEditorViewModel(
    private val cardsRepository: CardsRepository,
    editingCardId: String?
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = CardEditorUiState(
            isLoading = true,
            title = if (editingCardId == null) "New card" else "Edit card",
            isEditing = editingCardId != null,
            frontText = "",
            backText = "",
            tagsText = "",
            effortLevel = EffortLevel.FAST,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<CardEditorUiState>

    init {
        val cardFlow: Flow<CardSummary?> = if (editingCardId == null) {
            flowOf(null)
        } else {
            cardsRepository.observeCard(cardId = editingCardId)
        }

        uiState = combine(
            cardFlow,
            inputState
        ) { card, currentState ->
            currentState.copy(
                isLoading = false,
                frontText = if (currentState.frontText.isEmpty() && card != null) card.frontText else currentState.frontText,
                backText = if (currentState.backText.isEmpty() && card != null) card.backText else currentState.backText,
                tagsText = if (currentState.tagsText.isEmpty() && card != null) card.tags.joinToString(separator = ", ") else currentState.tagsText,
                effortLevel = if (currentState.frontText.isEmpty() && currentState.backText.isEmpty() && card != null) card.effortLevel else currentState.effortLevel
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
            initialValue = inputState.value
        )
    }

    fun updateFrontText(frontText: String) {
        inputState.update { state ->
            state.copy(frontText = frontText, errorMessage = "")
        }
    }

    fun updateBackText(backText: String) {
        inputState.update { state ->
            state.copy(backText = backText, errorMessage = "")
        }
    }

    fun updateTagsText(tagsText: String) {
        inputState.update { state ->
            state.copy(tagsText = tagsText, errorMessage = "")
        }
    }

    fun updateEffortLevel(effortLevel: EffortLevel) {
        inputState.update { state ->
            state.copy(effortLevel = effortLevel, errorMessage = "")
        }
    }

    suspend fun save(editingCardId: String?): Boolean {
        val state = uiState.value
        val trimmedFront = state.frontText.trim()
        val trimmedBack = state.backText.trim()

        if (trimmedFront.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = "Front text is required.")
            }
            return false
        }
        if (trimmedBack.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = "Back text is required.")
            }
            return false
        }

        val cardDraft = CardDraft(
            frontText = trimmedFront,
            backText = trimmedBack,
            tags = parseTags(tagsText = state.tagsText),
            effortLevel = state.effortLevel
        )

        // TODO: Port advanced card editor parity from apps/ios/Flashcards/Flashcards/CardEditorScreen.swift.
        return if (editingCardId == null) {
            cardsRepository.createCard(cardDraft = cardDraft)
            true
        } else {
            cardsRepository.updateCard(cardId = editingCardId, cardDraft = cardDraft)
            true
        }
    }

    suspend fun delete(editingCardId: String): Boolean {
        // TODO: Port swipe/detail parity decisions from apps/ios/Flashcards/Flashcards/CardsScreen.swift.
        cardsRepository.deleteCard(cardId = editingCardId)
        return true
    }
}

fun createCardsViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardsViewModel(
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

fun createCardEditorViewModelFactory(
    cardsRepository: CardsRepository,
    editingCardId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardEditorViewModel(
                cardsRepository = cardsRepository,
                editingCardId = editingCardId
            )
        }
    }
}

private fun parseTags(tagsText: String): List<String> {
    return normalizeTags(
        values = tagsText.split(","),
        referenceTags = emptyList()
    )
}
