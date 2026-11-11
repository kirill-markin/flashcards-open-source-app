package com.flashcardsopensourceapp.feature.cards.library

import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.libraryExportAnkiRowTag
import com.flashcardsopensourceapp.feature.cards.libraryExportNibomoRowTag
import com.flashcardsopensourceapp.feature.cards.libraryExportScreenTag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryExportRoute(
    onOpenNibomoExport: () -> Unit,
    onOpenAnkiExport: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.library_export_title))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.cards_editor_back_content_description)
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
                .testTag(libraryExportScreenTag)
        ) {
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_export_nibomo_title),
                    summary = null,
                    count = null,
                    testTag = libraryExportNibomoRowTag,
                    onClick = onOpenNibomoExport
                )
            }
            item {
                LibraryRow(
                    title = stringResource(id = R.string.library_export_anki_title),
                    summary = null,
                    count = null,
                    testTag = libraryExportAnkiRowTag,
                    onClick = onOpenAnkiExport
                )
            }
        }
    }
}
