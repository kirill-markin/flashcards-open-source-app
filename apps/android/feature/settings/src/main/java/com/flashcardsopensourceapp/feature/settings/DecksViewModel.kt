package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

class DecksViewModel(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<DecksUiState> = combine(
        decksRepository.observeDecks(),
        workspaceRepository.observeWorkspaceOverview(),
        searchQuery
    ) { decks, overview, query ->
        DecksUiState(
            searchQuery = query,
            deckEntries = filterDeckEntries(
                deckEntries = buildDeckListEntries(
                    decks = decks,
                    overview = overview
                ),
                searchQuery = query
            )
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DecksUiState(
            searchQuery = "",
            deckEntries = emptyList()
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

fun createDecksViewModelFactory(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DecksViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}
