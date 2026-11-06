package com.flashcardsopensourceapp.feature.cards.catalog

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.catalogDeckRowTag
import com.flashcardsopensourceapp.feature.cards.catalogEmptyStateTag
import com.flashcardsopensourceapp.feature.cards.catalogErrorStateTag
import com.flashcardsopensourceapp.feature.cards.catalogLanguageFilterTag
import com.flashcardsopensourceapp.feature.cards.catalogLoadingStateTag
import com.flashcardsopensourceapp.feature.cards.catalogRetryButtonTag
import com.flashcardsopensourceapp.feature.cards.catalogScreenTag
import com.flashcardsopensourceapp.feature.cards.catalogSearchFieldTag
import com.flashcardsopensourceapp.feature.cards.catalogSortFilterTag
import com.flashcardsopensourceapp.feature.cards.formatCardsCount
import java.text.Collator
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogRoute(
    uiState: CatalogUiState,
    onSearchQueryChange: (String) -> Unit,
    onSelectLanguageFilter: (CatalogLanguageFilter) -> Unit,
    onSelectSortOrder: (CatalogSortOrder) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        modifier = Modifier.imePadding(),
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.library_deck_catalog_title))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.catalog_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        val contentModifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)
            .testTag(catalogScreenTag)
        when (val content = uiState.content) {
            CatalogContentUiState.Loading -> Box(
                contentAlignment = Alignment.Center,
                modifier = contentModifier
            ) {
                CircularProgressIndicator(modifier = Modifier.testTag(catalogLoadingStateTag))
            }

            CatalogContentUiState.LoadFailed -> CatalogLoadFailedContent(
                onRetry = onRetry,
                modifier = contentModifier
            )

            is CatalogContentUiState.Ready -> CatalogReadyContent(
                uiState = uiState,
                content = content,
                onSearchQueryChange = onSearchQueryChange,
                onSelectLanguageFilter = onSelectLanguageFilter,
                onSelectSortOrder = onSelectSortOrder,
                modifier = contentModifier
            )
        }
    }
}

@Composable
private fun CatalogLoadFailedContent(
    onRetry: () -> Unit,
    modifier: Modifier
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier.padding(24.dp)
    ) {
        Text(
            text = stringResource(id = R.string.catalog_load_failed),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(catalogErrorStateTag)
        )
        Button(
            onClick = onRetry,
            modifier = Modifier.testTag(catalogRetryButtonTag)
        ) {
            Text(stringResource(id = R.string.catalog_retry))
        }
    }
}

@Composable
private fun CatalogReadyContent(
    uiState: CatalogUiState,
    content: CatalogContentUiState.Ready,
    onSearchQueryChange: (String) -> Unit,
    onSelectLanguageFilter: (CatalogLanguageFilter) -> Unit,
    onSelectSortOrder: (CatalogSortOrder) -> Unit,
    modifier: Modifier
) {
    val listState = rememberLazyListState()
    // A new query, filter or order is a new list: start it from the top. The applied key is saved
    // so coming back to this screen keeps the scroll position.
    val listQueryKey = "${uiState.searchQuery}|${uiState.languageFilter}|${uiState.sortOrder}"
    var scrolledListQueryKey by rememberSaveable { mutableStateOf(value = listQueryKey) }
    LaunchedEffect(listQueryKey) {
        if (listQueryKey != scrolledListQueryKey) {
            listState.scrollToItem(index = 0)
            scrolledListQueryKey = listQueryKey
        }
    }
    Column(modifier = modifier) {
        CatalogSearchField(
            searchQuery = uiState.searchQuery,
            onSearchQueryChange = onSearchQueryChange
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            CatalogLanguageFilterChip(
                languageFilter = uiState.languageFilter,
                availableLanguageCodes = content.availableLanguageCodes,
                onSelectLanguageFilter = onSelectLanguageFilter
            )
            CatalogSortChip(
                sortOrder = uiState.sortOrder,
                onSelectSortOrder = onSelectSortOrder
            )
        }
        CatalogDeckList(listState = listState, content = content)
    }
}

@Composable
private fun ColumnScope.CatalogDeckList(
    listState: LazyListState,
    content: CatalogContentUiState.Ready
) {
    LazyColumn(
        state = listState,
        modifier = Modifier.weight(1f)
    ) {
        if (content.decks.isEmpty()) {
            item {
                Text(
                    text = if (content.isCatalogEmpty) {
                        stringResource(id = R.string.catalog_empty_no_decks)
                    } else {
                        stringResource(id = R.string.catalog_empty_no_matches)
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 24.dp)
                        .testTag(catalogEmptyStateTag)
                )
            }
        } else {
            items(content.decks, key = { deck -> deck.packageId }) { deck ->
                CatalogDeckRow(deck = deck)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CatalogSearchField(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    // Filters the list below in place, so the bar never expands into its own results view.
    SearchBar(
        inputField = {
            SearchBarDefaults.InputField(
                query = searchQuery,
                onQueryChange = onSearchQueryChange,
                onSearch = {
                    keyboardController?.hide()
                },
                expanded = false,
                onExpandedChange = {},
                placeholder = {
                    Text(stringResource(id = R.string.catalog_search_placeholder))
                },
                leadingIcon = {
                    Icon(imageVector = Icons.Outlined.Search, contentDescription = null)
                },
                trailingIcon = if (searchQuery.isEmpty()) {
                    null
                } else {
                    {
                        IconButton(onClick = { onSearchQueryChange("") }) {
                            Icon(
                                imageVector = Icons.Outlined.Close,
                                contentDescription = stringResource(id = R.string.catalog_clear_search_content_description)
                            )
                        }
                    }
                },
                modifier = Modifier.testTag(catalogSearchFieldTag)
            )
        },
        expanded = false,
        onExpandedChange = {},
        windowInsets = WindowInsets(0, 0, 0, 0),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {}
}

@Composable
private fun CatalogLanguageFilterChip(
    languageFilter: CatalogLanguageFilter,
    availableLanguageCodes: List<String>,
    onSelectLanguageFilter: (CatalogLanguageFilter) -> Unit
) {
    val locale = currentResourceLocale(resources = LocalResources.current)
    var isMenuExpanded by rememberSaveable { mutableStateOf(value = false) }
    val languageOptions = remember(availableLanguageCodes, locale) {
        val collator = Collator.getInstance(locale)
        availableLanguageCodes
            .map { languageCode ->
                languageCode to catalogLanguageDisplayName(languageCode = languageCode, locale = locale)
            }
            .sortedWith { left, right -> collator.compare(left.second, right.second) }
    }
    val allLanguagesLabel = stringResource(id = R.string.catalog_language_all)
    val selectedLabel = when (languageFilter) {
        CatalogLanguageFilter.AllLanguages -> allLanguagesLabel
        is CatalogLanguageFilter.Language -> catalogLanguageDisplayName(
            languageCode = languageFilter.languageCode,
            locale = locale
        )
    }

    Box {
        FilterChip(
            selected = languageFilter is CatalogLanguageFilter.Language,
            onClick = { isMenuExpanded = true },
            label = { Text(selectedLabel) },
            trailingIcon = {
                Icon(imageVector = Icons.Outlined.ArrowDropDown, contentDescription = null)
            },
            modifier = Modifier.testTag(catalogLanguageFilterTag)
        )
        DropdownMenu(
            expanded = isMenuExpanded,
            onDismissRequest = { isMenuExpanded = false }
        ) {
            CatalogMenuItem(
                label = allLanguagesLabel,
                isSelected = languageFilter == CatalogLanguageFilter.AllLanguages,
                onClick = {
                    isMenuExpanded = false
                    onSelectLanguageFilter(CatalogLanguageFilter.AllLanguages)
                }
            )
            languageOptions.forEach { (languageCode, displayName) ->
                CatalogMenuItem(
                    label = displayName,
                    isSelected = languageFilter == CatalogLanguageFilter.Language(languageCode = languageCode),
                    onClick = {
                        isMenuExpanded = false
                        onSelectLanguageFilter(CatalogLanguageFilter.Language(languageCode = languageCode))
                    }
                )
            }
        }
    }
}

@Composable
private fun CatalogSortChip(
    sortOrder: CatalogSortOrder,
    onSelectSortOrder: (CatalogSortOrder) -> Unit
) {
    var isMenuExpanded by rememberSaveable { mutableStateOf(value = false) }
    val selectedLabel = catalogSortOrderLabel(sortOrder = sortOrder)
    val chipContentDescription = stringResource(id = R.string.catalog_sort_content_description, selectedLabel)

    Box {
        FilterChip(
            selected = sortOrder != CatalogSortOrder.RELEVANCE,
            onClick = { isMenuExpanded = true },
            label = { Text(selectedLabel) },
            leadingIcon = {
                Icon(imageVector = Icons.AutoMirrored.Outlined.Sort, contentDescription = null)
            },
            trailingIcon = {
                Icon(imageVector = Icons.Outlined.ArrowDropDown, contentDescription = null)
            },
            modifier = Modifier
                .testTag(catalogSortFilterTag)
                .semantics { contentDescription = chipContentDescription }
        )
        DropdownMenu(
            expanded = isMenuExpanded,
            onDismissRequest = { isMenuExpanded = false }
        ) {
            CatalogSortOrder.entries.forEach { option ->
                CatalogMenuItem(
                    label = catalogSortOrderLabel(sortOrder = option),
                    isSelected = option == sortOrder,
                    onClick = {
                        isMenuExpanded = false
                        onSelectSortOrder(option)
                    }
                )
            }
        }
    }
}

@Composable
private fun CatalogMenuItem(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    DropdownMenuItem(
        text = { Text(label) },
        onClick = onClick,
        trailingIcon = if (isSelected) {
            {
                Icon(imageVector = Icons.Outlined.Check, contentDescription = null)
            }
        } else {
            null
        }
    )
}

@Composable
private fun CatalogDeckRow(deck: CatalogBrowseIndexDeck) {
    val resources = LocalResources.current
    val coverModifier = Modifier
        .size(width = 80.dp, height = 45.dp)
        .clip(RoundedCornerShape(8.dp))
    val placeholderPainter = ColorPainter(MaterialTheme.colorScheme.surfaceContainerHighest)

    ListItem(
        leadingContent = {
            if (deck.coverImageUrl == null) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = coverModifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Style,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                AsyncImage(
                    model = deck.coverImageUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    placeholder = placeholderPainter,
                    error = placeholderPainter,
                    modifier = coverModifier
                )
            }
        },
        headlineContent = {
            Text(deck.title)
        },
        supportingContent = {
            Column {
                Text(
                    text = deck.summary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = pluralStringResource(
                        id = R.plurals.catalog_deck_card_count,
                        count = deck.cardCount,
                        formatCardsCount(resources = resources, count = deck.cardCount)
                    ),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        },
        modifier = Modifier.testTag(catalogDeckRowTag)
    )
}

@Composable
private fun catalogSortOrderLabel(sortOrder: CatalogSortOrder): String {
    return when (sortOrder) {
        CatalogSortOrder.RELEVANCE -> stringResource(id = R.string.catalog_sort_relevance)
        CatalogSortOrder.TITLE -> stringResource(id = R.string.catalog_sort_title)
        CatalogSortOrder.NEWEST -> stringResource(id = R.string.catalog_sort_newest)
    }
}

private fun catalogLanguageDisplayName(languageCode: String, locale: Locale): String {
    return Locale.forLanguageTag(languageCode)
        .getDisplayLanguage(locale)
        .replaceFirstChar { character -> character.titlecase(locale) }
}
