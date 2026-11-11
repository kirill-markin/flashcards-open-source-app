package com.flashcardsopensourceapp.feature.cards.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.formatCardsCount
import com.flashcardsopensourceapp.feature.cards.libraryAnkiExportRowTag
import com.flashcardsopensourceapp.feature.cards.libraryCardsRowTag
import com.flashcardsopensourceapp.feature.cards.libraryDeckCatalogRowTag
import com.flashcardsopensourceapp.feature.cards.libraryDecksRowTag
import com.flashcardsopensourceapp.feature.cards.libraryExportRowTag
import com.flashcardsopensourceapp.feature.cards.libraryImportRowTag
import com.flashcardsopensourceapp.feature.cards.libraryScreenTag
import com.flashcardsopensourceapp.feature.cards.libraryTagsRowTag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryRoute(
    uiState: LibraryUiState,
    onOpenCards: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenDeckCatalog: () -> Unit,
    onOpenImport: () -> Unit,
    onOpenExport: () -> Unit,
    onOpenAnkiExport: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.library_title))
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .testTag(libraryScreenTag)
        ) {
            item {
                LibrarySectionTitle(title = stringResource(id = R.string.library_your_cards_section_title))
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_cards_title),
                    summary = null,
                    count = uiState.cardsCount,
                    testTag = libraryCardsRowTag,
                    onClick = onOpenCards
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_tags_title),
                    summary = null,
                    count = uiState.tagsCount,
                    testTag = libraryTagsRowTag,
                    onClick = onOpenTags
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_decks_title),
                    summary = null,
                    count = uiState.decksCount,
                    testTag = libraryDecksRowTag,
                    onClick = onOpenDecks
                )
            }
            item {
                LibrarySectionTitle(title = stringResource(id = R.string.library_add_cards_section_title))
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_deck_catalog_title),
                    summary = stringResource(id = R.string.library_deck_catalog_summary),
                    count = null,
                    testTag = libraryDeckCatalogRowTag,
                    onClick = onOpenDeckCatalog
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_import_title),
                    summary = stringResource(id = R.string.library_import_summary),
                    count = null,
                    testTag = libraryImportRowTag,
                    onClick = onOpenImport
                )
            }
            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_export_title),
                    summary = stringResource(id = R.string.library_export_summary),
                    count = null,
                    testTag = libraryExportRowTag,
                    onClick = onOpenExport
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_anki_export_title),
                    summary = stringResource(id = R.string.library_anki_export_summary),
                    count = null,
                    testTag = libraryAnkiExportRowTag,
                    onClick = onOpenAnkiExport
                )
            }
        }
    }
}

@Composable
private fun LibrarySectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .padding(start = 16.dp, top = 24.dp, end = 16.dp, bottom = 8.dp)
            .semantics { heading() }
    )
}

@Composable
private fun LibraryRow(
    title: String,
    summary: String?,
    count: Int?,
    testTag: String,
    onClick: () -> Unit
) {
    val resources = LocalResources.current
    val trailingContent: (@Composable () -> Unit)? = count?.let { rowCount ->
        {
            Text(
                text = formatCardsCount(resources = resources, count = rowCount),
                style = MaterialTheme.typography.labelLarge
            )
        }
    }

    val supportingContent: (@Composable () -> Unit)? = summary?.let { rowSummary ->
        {
            Text(rowSummary)
        }
    }

    ListItem(
        headlineContent = {
            Text(title)
        },
        supportingContent = supportingContent,
        trailingContent = trailingContent,
        modifier = Modifier
            .testTag(testTag)
            .clickable(onClick = onClick)
    )
}
