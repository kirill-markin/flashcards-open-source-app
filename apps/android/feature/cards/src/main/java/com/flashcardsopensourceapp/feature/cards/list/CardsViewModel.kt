package com.flashcardsopensourceapp.feature.cards.list

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.feature.cards.CardsTextProvider
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
class CardsViewModel(
    private val cardsRepository: CardsRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository,
    private val textProvider: CardsTextProvider
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
        messageController.showMessage(message = textProvider.cardsUpdatedOnAnotherDeviceMessage)
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
