package com.flashcardsopensourceapp.feature.cards.library

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSource
import com.flashcardsopensourceapp.data.local.model.ai.AiImportSourceInput
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.libraryImportNibomoRowTag
import com.flashcardsopensourceapp.feature.cards.libraryImportScreenTag
import com.flashcardsopensourceapp.feature.cards.libraryImportSourceRowTag
import com.flashcardsopensourceapp.feature.cards.libraryImportSpreadsheetRowTag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryImportRoute(
    onOpenNibomoImport: () -> Unit,
    onOpenBrandImport: (AiImportSource) -> Unit,
    onOpenSpreadsheetImport: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(id = R.string.library_import_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.library_import_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .testTag(libraryImportScreenTag)
        ) {
            item {
                LibrarySectionTitle(title = stringResource(id = R.string.library_import_other_apps_section_title))
            }
            items(items = AiImportSource.entries, key = AiImportSource::id) { source ->
                LibraryRow(
                    title = libraryImportSourceTitle(source = source),
                    summary = libraryImportSourceSummary(source = source),
                    count = null,
                    testTag = libraryImportSourceRowTag(sourceId = source.id),
                    onClick = { onOpenBrandImport(source) }
                )
            }
            item {
                LibrarySectionTitle(title = stringResource(id = R.string.library_import_your_files_section_title))
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_import_nibomo_title),
                    summary = stringResource(id = R.string.library_import_nibomo_summary),
                    count = null,
                    testTag = libraryImportNibomoRowTag,
                    onClick = onOpenNibomoImport
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_import_spreadsheet_title),
                    summary = stringResource(id = R.string.library_import_spreadsheet_summary),
                    count = null,
                    testTag = libraryImportSpreadsheetRowTag,
                    onClick = onOpenSpreadsheetImport
                )
            }
        }
    }
}

@Composable
private fun libraryImportSourceTitle(source: AiImportSource): String {
    val brandName = source.brandName
    return if (brandName == null) {
        stringResource(id = R.string.library_import_other_title)
    } else {
        stringResource(id = R.string.library_import_brand_title, brandName)
    }
}

@Composable
private fun libraryImportSourceSummary(source: AiImportSource): String {
    return when (val input = source.input) {
        is AiImportSourceInput.PastedText -> stringResource(id = R.string.library_import_quizlet_summary)
        is AiImportSourceInput.Files -> input.formats
    }
}
