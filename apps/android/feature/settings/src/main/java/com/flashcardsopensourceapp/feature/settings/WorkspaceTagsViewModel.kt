package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

class WorkspaceTagsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")

    val uiState: StateFlow<WorkspaceTagsUiState> = combine(
        workspaceRepository.observeWorkspaceTagsSummary(),
        searchQuery
    ) { tagsSummary, query ->
        WorkspaceTagsUiState(
            searchQuery = query,
            tags = filterTags(
                tags = tagsSummary.tags,
                searchQuery = query
            ),
            totalCards = tagsSummary.totalCards
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceTagsUiState(
            searchQuery = "",
            tags = emptyList(),
            totalCards = 0
        )
    )

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }
}

fun createWorkspaceTagsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceTagsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

private fun filterTags(tags: List<WorkspaceTagSummary>, searchQuery: String): List<WorkspaceTagSummary> {
    val normalizedQuery = normalizeTagKey(tag = searchQuery)

    if (normalizedQuery.isEmpty()) {
        return tags
    }

    return tags.filter { tagSummary ->
        normalizeTagKey(tag = tagSummary.tag).contains(normalizedQuery)
    }
}
