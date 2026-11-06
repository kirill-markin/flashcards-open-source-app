package com.flashcardsopensourceapp.feature.cards.catalog

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexCacheState
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogBrowseIndexRepository
import com.flashcardsopensourceapp.data.local.repository.catalog.CatalogDeckPageRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Locale

private const val catalogViewModelLogTag: String = "CatalogViewModel"
private const val catalogPrefetchDeckCount: Int = 10
// Lets typing in search settle, so only the list the person stops on is prefetched.
private const val catalogPrefetchDelayMillis: Long = 500L

sealed interface CatalogContentUiState {
    data object Loading : CatalogContentUiState
    data object LoadFailed : CatalogContentUiState

    data class Ready(
        val decks: List<CatalogBrowseIndexDeck>,
        val availableLanguageCodes: List<String>,
        val isCatalogEmpty: Boolean
    ) : CatalogContentUiState
}

data class CatalogUiState(
    val searchQuery: String,
    val languageFilter: CatalogLanguageFilter,
    val sortOrder: CatalogSortOrder,
    val content: CatalogContentUiState
)

private enum class CatalogRefreshStatus {
    IDLE,
    RUNNING,
    FAILED
}

private sealed interface CatalogSearchableIndexState {
    data object Loading : CatalogSearchableIndexState
    data object Empty : CatalogSearchableIndexState

    data class Ready(
        val decks: List<CatalogSearchableDeck>,
        val availableLanguageCodes: List<String>
    ) : CatalogSearchableIndexState
}

private data class CatalogQueryInputs(
    val searchQuery: String,
    val selectedLanguageFilter: CatalogLanguageFilter?,
    val sortOrder: CatalogSortOrder,
    val locale: Locale
)

class CatalogViewModel(
    private val catalogBrowseIndexRepository: CatalogBrowseIndexRepository,
    private val catalogDeckPageRepository: CatalogDeckPageRepository,
    private val messageController: TransientMessageController,
    private val refreshFailedMessage: String
) : ViewModel() {
    private val searchQuery = MutableStateFlow(value = "")
    // Null until the person picks a language, so the default follows the app language and the index.
    private val selectedLanguageFilter = MutableStateFlow<CatalogLanguageFilter?>(value = null)
    private val sortOrder = MutableStateFlow(value = CatalogSortOrder.RELEVANCE)
    private val locale = MutableStateFlow(value = Locale.getDefault())
    private val refreshStatus = MutableStateFlow(value = CatalogRefreshStatus.IDLE)
    private var refreshJob: Job? = null
    private var prefetchJob: Job? = null

    private val searchableIndex = catalogBrowseIndexRepository.observeCacheState().map { cacheState ->
        when (cacheState) {
            CatalogBrowseIndexCacheState.Loading -> CatalogSearchableIndexState.Loading
            CatalogBrowseIndexCacheState.Empty -> CatalogSearchableIndexState.Empty
            is CatalogBrowseIndexCacheState.Ready -> {
                val decks = makeCatalogSearchableDecks(decks = cacheState.index.decks)
                CatalogSearchableIndexState.Ready(
                    decks = decks,
                    availableLanguageCodes = catalogAvailableLanguageCodes(decks = decks)
                )
            }
        }
    }

    private val queryInputs = combine(
        searchQuery,
        selectedLanguageFilter,
        sortOrder,
        locale
    ) { query, languageFilter, order, currentLocale ->
        CatalogQueryInputs(
            searchQuery = query,
            selectedLanguageFilter = languageFilter,
            sortOrder = order,
            locale = currentLocale
        )
    }

    val uiState: StateFlow<CatalogUiState> = combine(
        searchableIndex,
        queryInputs,
        refreshStatus
    ) { index, inputs, status ->
        val availableLanguageCodes = (index as? CatalogSearchableIndexState.Ready)?.availableLanguageCodes ?: emptyList()
        val languageFilter = inputs.selectedLanguageFilter ?: defaultCatalogLanguageFilter(
            availableLanguageCodes = availableLanguageCodes,
            appLanguageCode = inputs.locale.language
        )
        CatalogUiState(
            searchQuery = inputs.searchQuery,
            languageFilter = languageFilter,
            sortOrder = inputs.sortOrder,
            content = when (index) {
                is CatalogSearchableIndexState.Ready -> CatalogContentUiState.Ready(
                    decks = queryCatalogDecks(
                        decks = index.decks,
                        searchQuery = inputs.searchQuery,
                        languageFilter = languageFilter,
                        sortOrder = inputs.sortOrder,
                        locale = inputs.locale
                    ),
                    availableLanguageCodes = availableLanguageCodes,
                    isCatalogEmpty = index.decks.isEmpty()
                )

                CatalogSearchableIndexState.Loading,
                CatalogSearchableIndexState.Empty -> if (status == CatalogRefreshStatus.FAILED) {
                    CatalogContentUiState.LoadFailed
                } else {
                    CatalogContentUiState.Loading
                }
            }
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CatalogUiState(
            searchQuery = "",
            languageFilter = CatalogLanguageFilter.AllLanguages,
            sortOrder = CatalogSortOrder.RELEVANCE,
            content = CatalogContentUiState.Loading
        )
    )

    fun updateLocale(locale: Locale) {
        this.locale.value = locale
    }

    fun updateSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun selectLanguageFilter(languageFilter: CatalogLanguageFilter) {
        selectedLanguageFilter.value = languageFilter
    }

    fun selectSortOrder(sortOrder: CatalogSortOrder) {
        this.sortOrder.value = sortOrder
    }

    /** Prepares the deck pages of the first decks [shownDecks] puts on screen. */
    fun prefetchDeckPages(shownDecks: List<CatalogBrowseIndexDeck>) {
        prefetchJob?.cancel()
        prefetchJob = viewModelScope.launch {
            delay(catalogPrefetchDelayMillis)
            catalogDeckPageRepository.prefetchDeckPages(decks = shownDecks.take(catalogPrefetchDeckCount))
        }
    }

    /** Shows the cached index at once and checks the server in the background. */
    fun revalidate() {
        if (refreshJob?.isActive == true) {
            return
        }
        refreshJob = viewModelScope.launch {
            refreshStatus.value = CatalogRefreshStatus.RUNNING
            try {
                catalogBrowseIndexRepository.revalidateIfStale()
                refreshStatus.value = CatalogRefreshStatus.IDLE
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(catalogViewModelLogTag, "event=catalog_browse_index_revalidate_failed", error)
                refreshStatus.value = CatalogRefreshStatus.FAILED
                if (catalogBrowseIndexRepository.observeCacheState().value is CatalogBrowseIndexCacheState.Ready) {
                    messageController.showMessage(message = refreshFailedMessage)
                }
            }
        }
    }
}
