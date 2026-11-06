package com.flashcardsopensourceapp.feature.cards.catalog

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexCacheState
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckPage
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckUnavailableException
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogBrowseIndexRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogDeckInstallRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogDeckPageRepository
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private const val catalogDeckViewModelLogTag: String = "CatalogDeckViewModel"

sealed interface CatalogDeckPageUiState {
    data object Loading : CatalogDeckPageUiState
    data object LoadFailed : CatalogDeckPageUiState
    data class Ready(val page: CatalogDeckPage) : CatalogDeckPageUiState
}

enum class CatalogDeckStudyStatus {
    IDLE,
    RUNNING,
    FAILED
}

data class CatalogDeckUiState(
    /** Null until the on-device browse index is read. */
    val deck: CatalogBrowseIndexDeck?,
    val page: CatalogDeckPageUiState,
    val studyStatus: CatalogDeckStudyStatus
)

sealed interface CatalogDeckEvent {
    data object Close : CatalogDeckEvent
}

private sealed interface CatalogDeckIndexEntry {
    data object IndexLoading : CatalogDeckIndexEntry
    data object Missing : CatalogDeckIndexEntry
    data class Present(val deck: CatalogBrowseIndexDeck) : CatalogDeckIndexEntry
}

/** Shows one catalog deck, identified by its package, and runs "Study this deck". */
class CatalogDeckViewModel(
    private val packageId: String,
    private val catalogBrowseIndexRepository: CatalogBrowseIndexRepository,
    private val catalogDeckPageRepository: CatalogDeckPageRepository,
    private val catalogDeckInstallRepository: CatalogDeckInstallRepository,
    private val messageController: TransientMessageController,
    private val technicalErrorController: AppTechnicalErrorController,
    private val requestReviewFilter: (ReviewFilter) -> Unit,
    private val unavailableMessage: String,
    private val technicalErrorTitle: String,
    private val studyFailedMessage: String
) : ViewModel() {
    private val pageState = MutableStateFlow<CatalogDeckPageUiState>(value = CatalogDeckPageUiState.Loading)
    private val studyStatus = MutableStateFlow(value = CatalogDeckStudyStatus.IDLE)
    private val eventsChannel = Channel<CatalogDeckEvent>(capacity = Channel.BUFFERED)
    private val pageReloadRequests = MutableStateFlow(value = 0)
    private var isClosing: Boolean = false
    private var didRevalidateStaleIndex: Boolean = false

    private val indexEntry: Flow<CatalogDeckIndexEntry> = catalogBrowseIndexRepository.observeCacheState()
        .map { cacheState ->
            when (cacheState) {
                // Empty is a cache that was never written, so the first server check is still due.
                CatalogBrowseIndexCacheState.Loading,
                CatalogBrowseIndexCacheState.Empty -> CatalogDeckIndexEntry.IndexLoading
                is CatalogBrowseIndexCacheState.Ready -> cacheState.index.decks
                    .firstOrNull { deck -> deck.packageId == packageId }
                    ?.let { deck -> CatalogDeckIndexEntry.Present(deck = deck) }
                    ?: CatalogDeckIndexEntry.Missing
            }
        }
        .distinctUntilChanged()

    val events: Flow<CatalogDeckEvent> = eventsChannel.receiveAsFlow()

    val uiState: StateFlow<CatalogDeckUiState> = combine(
        indexEntry,
        pageState,
        studyStatus
    ) { entry, page, status ->
        CatalogDeckUiState(
            deck = (entry as? CatalogDeckIndexEntry.Present)?.deck,
            page = page,
            studyStatus = status
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CatalogDeckUiState(
            deck = null,
            page = CatalogDeckPageUiState.Loading,
            studyStatus = CatalogDeckStudyStatus.IDLE
        )
    )

    init {
        if (catalogBrowseIndexRepository.observeCacheState().value !is CatalogBrowseIndexCacheState.Ready) {
            // Reached without the list first, as after process death. Without an index there is no
            // deck to show, and the list owns that failure's presentation.
            viewModelScope.launch {
                try {
                    catalogBrowseIndexRepository.revalidateIfStale()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    Log.w(catalogDeckViewModelLogTag, "event=catalog_browse_index_load_failed packageId=$packageId", error)
                    if (catalogBrowseIndexRepository.observeCacheState().value !is CatalogBrowseIndexCacheState.Ready) {
                        eventsChannel.trySend(CatalogDeckEvent.Close)
                    }
                }
            }
        }
        viewModelScope.launch {
            combine(indexEntry, pageReloadRequests) { entry, _ -> entry }.collectLatest { entry ->
                when (entry) {
                    CatalogDeckIndexEntry.IndexLoading -> Unit
                    CatalogDeckIndexEntry.Missing -> handleDeckUnavailable()
                    is CatalogDeckIndexEntry.Present -> loadPage(deck = entry.deck)
                }
            }
        }
    }

    fun retryPage() {
        pageReloadRequests.value += 1
    }

    fun studyDeck() {
        val deck = uiState.value.deck ?: return
        if (studyStatus.value == CatalogDeckStudyStatus.RUNNING) {
            return
        }
        studyStatus.value = CatalogDeckStudyStatus.RUNNING
        viewModelScope.launch {
            try {
                catalogDeckInstallRepository.installDeckIntoCurrentWorkspace(deck = deck)
                studyStatus.value = CatalogDeckStudyStatus.IDLE
                requestReviewFilter(makeReviewTagFilter(tagNames = listOf(deck.reviewTag)))
            } catch (error: CancellationException) {
                throw error
            } catch (error: CatalogDeckUnavailableException) {
                studyStatus.value = CatalogDeckStudyStatus.IDLE
                Log.w(catalogDeckViewModelLogTag, "event=catalog_deck_study_unavailable packageId=$packageId", error)
                handleDeckUnavailable()
            } catch (error: Exception) {
                studyStatus.value = CatalogDeckStudyStatus.FAILED
                Log.w(
                    catalogDeckViewModelLogTag,
                    "event=catalog_deck_study_failed packageId=$packageId packageVersionId=${deck.packageVersionId}",
                    error
                )
                if (error !is IOException) {
                    technicalErrorController.showTechnicalError(
                        error = makeAppTechnicalError(
                            title = technicalErrorTitle,
                            message = studyFailedMessage,
                            throwable = error
                        ),
                        throwable = error
                    )
                }
            }
        }
    }

    private suspend fun loadPage(deck: CatalogBrowseIndexDeck) {
        val currentPage = (pageState.value as? CatalogDeckPageUiState.Ready)?.page
        if (currentPage?.packageVersionId != deck.packageVersionId) {
            pageState.value = CatalogDeckPageUiState.Loading
        }
        val page = try {
            catalogDeckPageRepository.loadDeckPage(deck = deck)
        } catch (error: CancellationException) {
            throw error
        } catch (error: CatalogDeckUnavailableException) {
            Log.w(catalogDeckViewModelLogTag, "event=catalog_deck_page_unavailable packageId=$packageId", error)
            handleDeckUnavailable()
            return
        } catch (error: Exception) {
            Log.w(
                catalogDeckViewModelLogTag,
                "event=catalog_deck_page_load_failed packageId=$packageId packageVersionId=${deck.packageVersionId}",
                error
            )
            pageState.value = CatalogDeckPageUiState.LoadFailed
            return
        }
        pageState.value = CatalogDeckPageUiState.Ready(page = page)
        if (page.latestPackageVersionId != deck.packageVersionId && didRevalidateStaleIndex.not()) {
            didRevalidateStaleIndex = true
            viewModelScope.launch {
                revalidateIndexNow()
            }
        }
    }

    /**
     * Runs outside the index collector on purpose: the revalidation drops this deck from the index,
     * which restarts that collector and would cancel the close.
     */
    private fun handleDeckUnavailable() {
        if (isClosing) {
            return
        }
        isClosing = true
        messageController.showMessage(message = unavailableMessage)
        viewModelScope.launch {
            revalidateIndexNow()
            eventsChannel.send(CatalogDeckEvent.Close)
        }
    }

    private suspend fun revalidateIndexNow() {
        try {
            catalogBrowseIndexRepository.revalidateNow()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(catalogDeckViewModelLogTag, "event=catalog_browse_index_revalidate_failed packageId=$packageId", error)
        }
    }
}
