package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.formatDeckFilterDefinition

@Composable
fun WorkspaceSettingsRoute(
    uiState: WorkspaceSettingsUiState,
    onOpenOverview: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenScheduler: () -> Unit,
    onOpenExport: () -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            DraftNoticeCard(
                title = "Workspace settings",
                body = "Decks stay Android-native filtered collections, while scheduler settings now drive review timing and workspace counts locally.",
                modifier = Modifier
            )
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Overview")
                    },
                    supportingContent = {
                        Text("${uiState.workspaceName} | ${uiState.totalCards} cards")
                    },
                    modifier = Modifier.clickable(onClick = onOpenOverview)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Decks")
                    },
                    supportingContent = {
                        Text("${uiState.deckCount} filtered decks")
                    },
                    modifier = Modifier.clickable(onClick = onOpenDecks)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Tags")
                    },
                    supportingContent = {
                        Text("${uiState.tagCount} tags")
                    },
                    modifier = Modifier.clickable(onClick = onOpenTags)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Scheduler")
                    },
                    supportingContent = {
                        Text(uiState.schedulerSummary)
                    },
                    modifier = Modifier.clickable(onClick = onOpenScheduler)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Export")
                    },
                    supportingContent = {
                        Text(uiState.exportSummary)
                    },
                    modifier = Modifier.clickable(onClick = onOpenExport)
                )
            }
        }
    }
}

@Composable
fun WorkspaceOverviewRoute(
    uiState: WorkspaceOverviewUiState,
    onWorkspaceNameChange: (String) -> Unit,
    onSaveWorkspaceName: () -> Unit,
    onRequestDeleteWorkspace: () -> Unit,
    onDismissDeletePreviewAlert: () -> Unit,
    onOpenDeleteConfirmation: () -> Unit,
    onDeleteConfirmationTextChange: (String) -> Unit,
    onDismissDeleteConfirmation: () -> Unit,
    onDeleteWorkspace: () -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        if (uiState.errorMessage.isNotEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = uiState.errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        }

        if (uiState.successMessage.isNotEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = uiState.successMessage,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(text = "Workspace", style = MaterialTheme.typography.titleMedium)
                    if (uiState.isLinked) {
                        OutlinedTextField(
                            value = uiState.workspaceNameDraft,
                            onValueChange = onWorkspaceNameChange,
                            label = {
                                Text("Workspace name")
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Button(
                            onClick = onSaveWorkspaceName,
                            enabled = uiState.isSavingName.not()
                                && uiState.workspaceNameDraft.trim().isNotEmpty()
                                && uiState.workspaceNameDraft != uiState.workspaceName,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (uiState.isSavingName) "Saving..." else "Save name")
                        }
                    } else {
                        Text(
                            text = uiState.workspaceName,
                            style = MaterialTheme.typography.headlineSmall
                        )
                        Text(
                            text = "Workspace rename is available only for linked cloud workspaces.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    HorizontalDivider()
                    OverviewRow(title = "Cards", value = uiState.totalCards)
                    OverviewRow(title = "Decks", value = uiState.deckCount)
                    OverviewRow(title = "Tags", value = uiState.tagCount)
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Today",
                        style = MaterialTheme.typography.titleMedium
                    )
                    OverviewRow(title = "Due", value = uiState.dueCount)
                    OverviewRow(title = "New", value = uiState.newCount)
                    OverviewRow(title = "Reviewed", value = uiState.reviewedCount)
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Danger zone",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    Text(
                        text = "Permanently delete this workspace and all cards, decks, reviews, and sync history inside it.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedButton(
                        onClick = onRequestDeleteWorkspace,
                        enabled = uiState.isLinked && uiState.isDeletePreviewLoading.not() && uiState.isDeletingWorkspace.not(),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            if (uiState.isDeletePreviewLoading) {
                                "Loading..."
                            } else {
                                "Delete workspace"
                            }
                        )
                    }
                    if (uiState.isLinked.not()) {
                        Text(
                            text = "Workspace delete is available only for linked cloud workspaces.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }

    if (uiState.showDeletePreviewAlert && uiState.deletePreview != null) {
        AlertDialog(
            onDismissRequest = onDismissDeletePreviewAlert,
            confirmButton = {
                TextButton(onClick = onOpenDeleteConfirmation) {
                    Text("Continue")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissDeletePreviewAlert) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Delete this workspace?")
            },
            text = {
                Text(
                    if (uiState.deletePreview.isLastAccessibleWorkspace) {
                        "This permanently deletes ${uiState.deletePreview.activeCardCount} active cards. A new empty Personal workspace will be created immediately after deletion."
                    } else {
                        "This permanently deletes ${uiState.deletePreview.activeCardCount} active cards from this workspace."
                    }
                )
            }
        )
    }

    if (uiState.showDeleteConfirmation && uiState.deletePreview != null) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isDeletingWorkspace.not()) {
                    onDismissDeleteConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onDeleteWorkspace,
                    enabled = uiState.isDeletingWorkspace.not()
                        && uiState.deleteConfirmationText == uiState.deletePreview.confirmationText
                ) {
                    Text(if (uiState.isDeletingWorkspace) "Deleting..." else "Delete workspace")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeletingWorkspace.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Delete workspace")
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Warning! This action is permanent. Type the phrase below exactly to continue.",
                        color = MaterialTheme.colorScheme.error
                    )
                    if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                        CircularProgressIndicator()
                    }
                    if (uiState.deleteState == DestructiveActionState.FAILED && uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Text(
                        text = uiState.deletePreview.confirmationText,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    OutlinedTextField(
                        value = uiState.deleteConfirmationText,
                        onValueChange = onDeleteConfirmationTextChange,
                        label = {
                            Text("Confirmation text")
                        },
                        enabled = uiState.isDeletingWorkspace.not(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulerSettingsRoute(
    uiState: SchedulerSettingsUiState,
    onDesiredRetentionChange: (String) -> Unit,
    onLearningStepsChange: (String) -> Unit,
    onRelearningStepsChange: (String) -> Unit,
    onMaximumIntervalDaysChange: (String) -> Unit,
    onEnableFuzzChange: (Boolean) -> Unit,
    onRequestSave: () -> Unit,
    onDismissSaveConfirmation: () -> Unit,
    onConfirmSave: () -> Unit,
    onResetToDefaults: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Scheduler")
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Algorithm",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(text = uiState.algorithm)
                        Text(
                            text = "Updated: ${uiState.updatedAtLabel}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.desiredRetentionText,
                    onValueChange = onDesiredRetentionChange,
                    label = {
                        Text("Desired retention")
                    },
                    supportingText = {
                        Text("Higher values bring cards back sooner.")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.learningStepsText,
                    onValueChange = onLearningStepsChange,
                    label = {
                        Text("Learning steps (minutes)")
                    },
                    supportingText = {
                        Text("Comma-separated step list, for example 1, 10")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.relearningStepsText,
                    onValueChange = onRelearningStepsChange,
                    label = {
                        Text("Relearning steps (minutes)")
                    },
                    supportingText = {
                        Text("Comma-separated step list after Again in review.")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.maximumIntervalDaysText,
                    onValueChange = onMaximumIntervalDaysChange,
                    label = {
                        Text("Maximum interval (days)")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Enable fuzz")
                        },
                        supportingContent = {
                            Text("Spread long-term review intervals a bit to avoid clustering.")
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.enableFuzz,
                                onCheckedChange = onEnableFuzzChange
                            )
                        }
                    )
                }
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onResetToDefaults,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Reset")
                    }
                    Button(
                        onClick = onRequestSave,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Save")
                    }
                }
            }
        }
    }

    if (uiState.showSaveConfirmation) {
        AlertDialog(
            onDismissRequest = onDismissSaveConfirmation,
            confirmButton = {
                TextButton(onClick = onConfirmSave) {
                    Text("Apply")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissSaveConfirmation) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Apply scheduler settings?")
            },
            text = {
                Text("This changes future review intervals only and keeps current card history intact.")
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DecksRoute(
    uiState: DecksUiState,
    onSearchQueryChange: (String) -> Unit,
    onOpenDeck: (String) -> Unit,
    onCreateDeck: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Decks")
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreateDeck
            ) {
                androidx.compose.material3.Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = "Add deck"
                )
            }
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 96.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = onSearchQueryChange,
                    label = {
                        Text("Search decks")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (uiState.decks.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (uiState.searchQuery.isEmpty()) {
                                "No decks yet. Create the first filtered deck."
                            } else {
                                "No decks match this search."
                            },
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            } else {
                items(uiState.decks, key = { deck -> deck.deckId }) { deck ->
                    DeckRow(
                        deck = deck,
                        onOpenDeck = onOpenDeck
                    )
                }
            }
        }
    }
}

@Composable
fun DeckDetailRoute(
    uiState: DeckDetailUiState,
    onEditDeck: (String) -> Unit,
    onOpenCard: (String) -> Unit,
    onDeleteDeck: (String) -> Unit
) {
    val deck = uiState.deck

    if (deck == null) {
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Deck not found.",
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        }
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = deck.name,
                        style = MaterialTheme.typography.headlineSmall
                    )
                    Text(
                        text = formatDeckFilterDefinition(filterDefinition = deck.filterDefinition),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OverviewRow(title = "Cards", value = deck.totalCards)
                    OverviewRow(title = "Due", value = deck.dueCards)
                    OverviewRow(title = "New", value = deck.newCards)
                    OverviewRow(title = "Reviewed", value = deck.reviewedCards)
                }
            }
        }

        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                OutlinedButton(
                    onClick = {
                        onEditDeck(deck.deckId)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Edit")
                }
                Button(
                    onClick = {
                        onDeleteDeck(deck.deckId)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Delete")
                }
            }
        }

        item {
            Text(
                text = "Matching cards",
                style = MaterialTheme.typography.titleMedium
            )
        }

        if (uiState.cards.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "This filtered deck has no matching cards yet.",
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        } else {
            items(uiState.cards, key = { card -> card.cardId }) { card ->
                DeckCardRow(
                    card = card,
                    onOpenCard = onOpenCard
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckEditorRoute(
    uiState: DeckEditorUiState,
    onNameChange: (String) -> Unit,
    onToggleEffortLevel: (EffortLevel) -> Unit,
    onToggleTag: (String) -> Unit,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(uiState.title)
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 32.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                if (uiState.errorMessage.isNotEmpty()) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.name,
                    onValueChange = onNameChange,
                    label = {
                        Text("Deck name")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Text(
                    text = "Effort",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    EffortLevel.entries.forEach { effortLevel ->
                        FilterChip(
                            selected = uiState.selectedEffortLevels.contains(effortLevel),
                            onClick = {
                                onToggleEffortLevel(effortLevel)
                            },
                            label = {
                                Text(effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() })
                            }
                        )
                    }
                }
            }

            item {
                Text(
                    text = "Tags",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (uiState.availableTags.isEmpty()) {
                item {
                    Text(
                        text = "No tags available yet. Create cards first, then use their tags in a deck rule.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        uiState.availableTags.forEach { tagSummary ->
                            FilterChip(
                                selected = uiState.selectedTags.contains(tagSummary.tag),
                                onClick = {
                                    onToggleTag(tagSummary.tag)
                                },
                                label = {
                                    Text("${tagSummary.tag} (${tagSummary.cardsCount})")
                                }
                            )
                        }
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(16.dp)
                    ) {
                        Text(
                            text = "Rule summary",
                            style = MaterialTheme.typography.titleSmall
                        )
                        Text(
                            text = formatDeckFilterDefinition(
                                filterDefinition = DeckFilterDefinition(
                                    version = 2,
                                    effortLevels = uiState.selectedEffortLevels,
                                    tags = uiState.selectedTags
                                )
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onBack,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = onSave,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Save")
                    }
                }
            }

            if (onDelete != null) {
                item {
                    HorizontalDivider()
                }

                item {
                    OutlinedButton(
                        onClick = onDelete,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Delete deck")
                    }
                }
            }
        }
    }
}

@Composable
fun WorkspaceTagsRoute(
    uiState: WorkspaceTagsUiState,
    onSearchQueryChange: (String) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = onSearchQueryChange,
                label = {
                    Text("Search tags")
                },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (uiState.tags.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.searchQuery.isEmpty()) {
                            "No tags have been used yet."
                        } else {
                            "No tags match this search."
                        },
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        } else {
            items(uiState.tags, key = { tag -> tag.tag }) { tagSummary ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(tagSummary.tag)
                        },
                        supportingContent = {
                            Text("${tagSummary.cardsCount} cards")
                        }
                    )
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Total cards")
                    },
                    supportingContent = {
                        Text("${uiState.totalCards}")
                    }
                )
            }
        }
    }
}

@Composable
private fun DeckRow(
    deck: DeckSummary,
    onOpenDeck: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenDeck(deck.deckId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = deck.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = formatDeckFilterDefinition(filterDefinition = deck.filterDefinition),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "${deck.totalCards} cards | ${deck.newCards} new | ${deck.reviewedCards} reviewed",
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

@Composable
private fun DeckCardRow(
    card: CardSummary,
    onOpenCard: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenCard(card.cardId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = card.frontText,
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = "Effort: ${card.effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() }}",
                color = MaterialTheme.colorScheme.primary
            )
            if (card.tags.isNotEmpty()) {
                Text(
                    text = card.tags.joinToString(separator = " | "),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun OverviewRow(title: String, value: Int) {
    Row(
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = title,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = value.toString(),
            style = MaterialTheme.typography.titleSmall
        )
    }
}
