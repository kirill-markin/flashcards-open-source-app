package com.flashcardsopensourceapp.feature.cards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class CardsViewModel(
    cardsRepository: CardsRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<CardsUiState> = combine(
        cardsRepository.observeCards(),
        searchQuery
    ) { cards, query ->
        CardsUiState(
            isLoading = false,
            searchQuery = query,
            cards = filterCards(cards = cards, query = query)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CardsUiState(
            isLoading = true,
            searchQuery = "",
            cards = emptyList()
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

class CardEditorViewModel(
    private val cardsRepository: CardsRepository,
    decksRepository: DecksRepository,
    editingCardId: String?
) : ViewModel() {
    private val inputState = MutableStateFlow(
        value = CardEditorUiState(
            isLoading = true,
            title = if (editingCardId == null) "New card" else "Edit card",
            isEditing = editingCardId != null,
            availableDecks = emptyList(),
            selectedDeckId = "",
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
            decksRepository.observeDecks(),
            cardFlow,
            inputState
        ) { decks, card, currentState ->
            val selectedDeckId = resolveSelectedDeckId(
                currentState = currentState,
                decks = decks,
                card = card
            )

            currentState.copy(
                isLoading = false,
                availableDecks = decks,
                selectedDeckId = selectedDeckId,
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

    fun updateDeck(deckId: String) {
        inputState.update { state ->
            state.copy(selectedDeckId = deckId, errorMessage = "")
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

        if (state.selectedDeckId.isEmpty()) {
            inputState.update { currentState ->
                currentState.copy(errorMessage = "Choose a deck before saving.")
            }
            return false
        }
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
            deckId = state.selectedDeckId,
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

fun createCardsViewModelFactory(cardsRepository: CardsRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardsViewModel(cardsRepository = cardsRepository)
        }
    }
}

fun createCardEditorViewModelFactory(
    cardsRepository: CardsRepository,
    decksRepository: DecksRepository,
    editingCardId: String?
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CardEditorViewModel(
                cardsRepository = cardsRepository,
                decksRepository = decksRepository,
                editingCardId = editingCardId
            )
        }
    }
}

private fun filterCards(cards: List<CardSummary>, query: String): List<CardSummary> {
    val normalizedQuery = query.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return cards
    }

    return cards.filter { card ->
        card.frontText.lowercase().contains(other = normalizedQuery)
            || card.backText.lowercase().contains(other = normalizedQuery)
            || card.deckName.lowercase().contains(other = normalizedQuery)
            || card.tags.any { tag -> tag.lowercase().contains(other = normalizedQuery) }
    }
}

private fun parseTags(tagsText: String): List<String> {
    return tagsText.split(",").map { tag ->
        tag.trim()
    }.filter { tag ->
        tag.isNotEmpty()
    }.distinct()
}

private fun resolveSelectedDeckId(
    currentState: CardEditorUiState,
    decks: List<DeckSummary>,
    card: CardSummary?
): String {
    if (currentState.selectedDeckId.isNotEmpty()) {
        return currentState.selectedDeckId
    }
    if (card != null) {
        return card.deckId
    }
    return decks.firstOrNull()?.deckId ?: ""
}
