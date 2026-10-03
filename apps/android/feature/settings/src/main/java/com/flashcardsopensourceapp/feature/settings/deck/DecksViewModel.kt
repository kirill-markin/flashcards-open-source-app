package com.flashcardsopensourceapp.feature.settings.deck

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import java.util.Locale

class DecksViewModel(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")
    private val locale = MutableStateFlow(value = strings.locale())

    val uiState: StateFlow<DecksUiState> = combine(
        decksRepository.observeDecks(),
        workspaceRepository.observeWorkspaceOverview(),
        searchQuery,
        locale
    ) { decks, overview, query, currentLocale ->
        DecksUiState(
            searchQuery = query,
            deckEntries = filterDeckEntries(
                deckEntries = buildDeckListEntries(
                    decks = decks,
                    locale = currentLocale,
                    overview = overview,
                    strings = strings
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

    fun updateLocale(locale: Locale) {
        this.locale.value = locale
    }

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

fun createDecksViewModelFactory(
    decksRepository: DecksRepository,
    workspaceRepository: WorkspaceRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DecksViewModel(
                decksRepository = decksRepository,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
