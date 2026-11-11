package com.flashcardsopensourceapp.feature.settings.workspace.tags

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.isCardDue
import com.flashcardsopensourceapp.data.local.model.cards.isNewCard
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class WorkspaceTagDetailStats(
    val totalCards: Int,
    val newCards: Int,
    val dueCards: Int
)

class WorkspaceTagDetailViewModel(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    workspaceId: String,
    tag: String
) : ViewModel() {
    val stats: StateFlow<WorkspaceTagDetailStats?> = combine(
        workspaceRepository.observeWorkspace(),
        cardsRepository.observeCards(searchQuery = "", filter = CardFilter(tags = listOf(tag)))
    ) { workspace, cards ->
        val matchingCards = cards.filter { card ->
            workspace?.workspaceId == workspaceId && card.workspaceId == workspaceId
        }
        val nowMillis = System.currentTimeMillis()
        WorkspaceTagDetailStats(
            totalCards = matchingCards.size,
            newCards = matchingCards.count(::isNewCard),
            dueCards = matchingCards.count { card -> isCardDue(card = card, nowMillis = nowMillis) }
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
}

fun createWorkspaceTagDetailViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    workspaceId: String,
    tag: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceTagDetailViewModel(
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                workspaceId = workspaceId,
                tag = tag
            )
        }
    }
}
