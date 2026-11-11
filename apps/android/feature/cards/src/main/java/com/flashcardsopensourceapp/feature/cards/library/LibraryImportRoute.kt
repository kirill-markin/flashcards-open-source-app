package com.flashcardsopensourceapp.feature.cards.library

import androidx.compose.foundation.layout.Column
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
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.libraryImportAnkiRowTag
import com.flashcardsopensourceapp.feature.cards.libraryImportNibomoRowTag
import com.flashcardsopensourceapp.feature.cards.libraryImportScreenTag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryImportRoute(
    onOpenNibomoImport: () -> Unit,
    onOpenAnkiImport: () -> Unit,
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .testTag(libraryImportScreenTag)
        ) {
            LibraryRow(
                title = stringResource(id = R.string.library_import_nibomo_format),
                summary = stringResource(id = R.string.library_import_nibomo_summary),
                count = null,
                testTag = libraryImportNibomoRowTag,
                onClick = onOpenNibomoImport
            )
            LibraryRow(
                title = stringResource(id = R.string.library_import_anki_format),
                summary = stringResource(id = R.string.library_import_anki_summary),
                count = null,
                testTag = libraryImportAnkiRowTag,
                onClick = onOpenAnkiImport
            )
        }
    }
}
