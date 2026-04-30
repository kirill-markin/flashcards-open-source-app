package com.flashcardsopensourceapp.feature.settings.deck

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

sealed interface DeckDetailRequest {
    data object AllCards : DeckDetailRequest

    data class PersistedDeck(
        val deckId: String
    ) : DeckDetailRequest
}

class DeckDetailViewModel(
    decksRepository: DecksRepository,
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    deckDetailRequest: DeckDetailRequest,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val deckFilter = CardFilter(
        tags = emptyList(),
        effort = emptyList()
    )

    val uiState: StateFlow<DeckDetailUiState> = when (deckDetailRequest) {
        DeckDetailRequest.AllCards -> {
            combine(
                workspaceRepository.observeWorkspaceOverview(),
                cardsRepository.observeCards(
                    searchQuery = "",
                    filter = deckFilter
                )
            ) { overview, cards ->
                DeckDetailUiState(
                    detail = buildAllCardsDeckDetailInfo(overview = overview, strings = strings),
                    cards = cards
                )
            }
        }

        is DeckDetailRequest.PersistedDeck -> {
            combine(
                decksRepository.observeDeck(deckId = deckDetailRequest.deckId),
                decksRepository.observeDeckCards(deckId = deckDetailRequest.deckId)
            ) { deck, cards ->
                DeckDetailUiState(
                    detail = deck?.let { value ->
                        toPersistedDeckDetailInfo(deck = value, strings = strings)
                    },
                    cards = cards
                )
            }
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeckDetailUiState(
            detail = when (deckDetailRequest) {
                DeckDetailRequest.AllCards -> buildAllCardsDeckDetailInfo(
                    overview = null,
                    strings = strings
                )
                is DeckDetailRequest.PersistedDeck -> null
            },
            cards = emptyList()
        )
    )
}

fun createDeckDetailViewModelFactory(
    decksRepository: DecksRepository,
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    deckId: String,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckDetailViewModel(
                decksRepository = decksRepository,
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                deckDetailRequest = DeckDetailRequest.PersistedDeck(deckId = deckId),
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

fun createAllCardsDeckDetailViewModelFactory(
    decksRepository: DecksRepository,
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeckDetailViewModel(
                decksRepository = decksRepository,
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                deckDetailRequest = DeckDetailRequest.AllCards,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
