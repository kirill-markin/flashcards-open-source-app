package com.flashcardsopensourceapp.feature.settings.workspace.tags

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.OverviewRow
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.deck.DeckCardRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceTagDetailRoute(
    tag: String,
    uiState: WorkspaceTagDetailUiState?,
    onOpenReview: () -> Unit,
    onResetProgress: () -> Unit,
    onRemoveTag: () -> Unit,
    onOpenCard: (String) -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(text = tag, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.settings_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
        ) {
            if (uiState == null) {
                item { CircularProgressIndicator() }
                return@LazyColumn
            }
            if (uiState.cards.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.settings_tag_detail_unavailable),
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
                return@LazyColumn
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        OverviewRow(title = stringResource(R.string.settings_tag_detail_total), value = uiState.cards.size)
                        OverviewRow(title = stringResource(R.string.settings_workspace_to_study_title), value = uiState.dueCards)
                        OverviewRow(title = stringResource(R.string.settings_workspace_new_title), value = uiState.newCards)
                    }
                }
            }

            item {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    val destructiveButtonColors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                    Button(
                        onClick = onOpenReview,
                        modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_review")
                    ) {
                        Text(stringResource(R.string.settings_tag_detail_open_review))
                    }
                    OutlinedButton(
                        onClick = onResetProgress,
                        colors = destructiveButtonColors,
                        modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_reset_progress")
                    ) {
                        Text(stringResource(R.string.settings_reset_study_progress_title))
                    }
                    OutlinedButton(
                        onClick = onRemoveTag,
                        colors = destructiveButtonColors,
                        modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_remove")
                    ) {
                        Text(stringResource(R.string.settings_tag_detail_remove_tag))
                    }
                }
            }

            item {
                Text(
                    text = stringResource(R.string.settings_deck_matching_cards_title),
                    style = MaterialTheme.typography.titleMedium
                )
            }

            items(uiState.cards, key = { card -> card.cardId }) { card ->
                DeckCardRow(card = card, onOpenCard = onOpenCard)
            }
        }
    }
}
