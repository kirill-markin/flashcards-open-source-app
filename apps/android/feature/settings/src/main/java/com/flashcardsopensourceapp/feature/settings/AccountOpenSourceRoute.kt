package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material3.Card
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource

@Composable
fun AccountOpenSourceRoute(onBack: () -> Unit) {
    val context = LocalContext.current
    val repositoryUrl = stringResource(id = R.string.flashcards_repository_url)

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_open_source_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_repository_title),
                        summary = stringResource(R.string.settings_open_source_repository_summary),
                        icon = Icons.Outlined.Code,
                        onClick = {
                            openExternalUrl(context = context, url = repositoryUrl)
                        }
                    )
                }
            }
        }
    }
}
