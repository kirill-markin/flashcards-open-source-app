package com.flashcardsopensourceapp.feature.cards.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * Counts are null until the current workspace is loaded, so the hub never shows a placeholder zero.
 */
data class LibraryUiState(
    val cardsCount: Int?,
    val tagsCount: Int?,
    val decksCount: Int?
)

class LibraryViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<LibraryUiState> = workspaceRepository.observeWorkspaceOverview().map { overview ->
        LibraryUiState(
            cardsCount = overview?.totalCards,
            tagsCount = overview?.tagsCount,
            decksCount = overview?.deckCount
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = LibraryUiState(
            cardsCount = null,
            tagsCount = null,
            decksCount = null
        )
    )
}
