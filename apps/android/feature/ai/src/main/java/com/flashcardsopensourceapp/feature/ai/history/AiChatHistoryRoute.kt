package com.flashcardsopensourceapp.feature.ai.history

import android.text.format.DateUtils
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistorySummary
import com.flashcardsopensourceapp.data.local.model.ai.aiChatSessionTitleMaximumLength
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryBackButtonTag
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryCurrentMarkerTag
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryListTag
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryRowTag
import com.flashcardsopensourceapp.feature.ai.aiChatHistorySearchFieldTag
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

// Rows from the end of the loaded list at which the next page starts loading.
private const val aiChatHistoryLoadMoreThreshold: Int = 3

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatHistoryRoute(
    uiState: AiChatHistoryUiState,
    currentSessionId: String?,
    isCurrentChatArchiveDisabled: Boolean,
    onSearchQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenSession: (AiChatSessionHistorySummary) -> Unit,
    onRenameSession: (AiChatSessionHistorySummary, String) -> Unit,
    onArchiveSession: (AiChatSessionHistorySummary) -> Unit,
    onBack: () -> Unit
) {
    var renameTarget by remember { mutableStateOf<AiChatSessionHistorySummary?>(value = null) }
    var archiveTarget by remember { mutableStateOf<AiChatSessionHistorySummary?>(value = null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.ai_history_title))
                },
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier.testTag(tag = aiChatHistoryBackButtonTag)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.ai_history_back_content_description)
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
        ) {
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = onSearchQueryChange,
                placeholder = {
                    Text(stringResource(id = R.string.ai_history_search_placeholder))
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.Search,
                        contentDescription = null
                    )
                },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .testTag(tag = aiChatHistorySearchFieldTag)
            )

            PullToRefreshBox(
                isRefreshing = uiState.isRefreshing,
                onRefresh = onRefresh,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(weight = 1f)
            ) {
                AiChatHistoryList(
                    uiState = uiState,
                    currentSessionId = currentSessionId,
                    isCurrentChatArchiveDisabled = isCurrentChatArchiveDisabled,
                    onRetry = onRetry,
                    onLoadMore = onLoadMore,
                    onOpenSession = onOpenSession,
                    onRequestRename = { summary -> renameTarget = summary },
                    onRequestArchive = { summary -> archiveTarget = summary }
                )
            }
        }
    }

    renameTarget?.let { summary ->
        AiChatHistoryRenameDialog(
            summary = summary,
            onSave = { title ->
                renameTarget = null
                onRenameSession(summary, title)
            },
            onDismiss = { renameTarget = null }
        )
    }

    archiveTarget?.let { summary ->
        AlertDialog(
            onDismissRequest = { archiveTarget = null },
            title = {
                Text(stringResource(id = R.string.ai_history_archive_confirm))
            },
            text = {
                Text(summary.title ?: stringResource(id = R.string.ai_history_untitled_chat))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        archiveTarget = null
                        onArchiveSession(summary)
                    }
                ) {
                    Text(stringResource(id = R.string.ai_history_archive))
                }
            },
            dismissButton = {
                TextButton(onClick = { archiveTarget = null }) {
                    Text(stringResource(id = R.string.ai_cancel))
                }
            }
        )
    }
}

@Composable
private fun AiChatHistoryList(
    uiState: AiChatHistoryUiState,
    currentSessionId: String?,
    isCurrentChatArchiveDisabled: Boolean,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenSession: (AiChatSessionHistorySummary) -> Unit,
    onRequestRename: (AiChatSessionHistorySummary) -> Unit,
    onRequestArchive: (AiChatSessionHistorySummary) -> Unit
) {
    val lazyListState = rememberLazyListState()
    val listState = uiState.listState
    AiChatHistoryLoadMoreEffect(
        lazyListState = lazyListState,
        canLoadMore = listState is AiChatHistoryListState.Loaded && listState.nextCursor != null,
        onLoadMore = onLoadMore
    )

    LazyColumn(
        state = lazyListState,
        contentPadding = PaddingValues(bottom = 24.dp),
        modifier = Modifier
            .fillMaxSize()
            .testTag(tag = aiChatHistoryListTag)
    ) {
        if (uiState.showsUnavailableNotice) {
            item(key = "unavailable_notice") {
                Text(
                    text = stringResource(id = R.string.ai_history_unavailable),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
        }

        when (listState) {
            AiChatHistoryListState.Loading -> {
                item(key = "loading") {
                    AiChatHistoryStatus(modifier = Modifier.fillParentMaxSize()) {
                        CircularProgressIndicator()
                        Text(stringResource(id = R.string.ai_history_loading))
                    }
                }
            }

            AiChatHistoryListState.Failed -> {
                item(key = "load_error") {
                    AiChatHistoryStatus(modifier = Modifier.fillParentMaxSize()) {
                        Text(
                            text = stringResource(id = R.string.ai_history_load_error),
                            textAlign = TextAlign.Center
                        )
                        Button(onClick = onRetry) {
                            Text(stringResource(id = R.string.ai_retry))
                        }
                    }
                }
            }

            is AiChatHistoryListState.Loaded -> {
                // Archiving every loaded row empties the list while older pages remain to load.
                if (listState.sessions.isEmpty() && listState.nextCursor == null) {
                    item(key = "empty") {
                        AiChatHistoryStatus(modifier = Modifier.fillParentMaxSize()) {
                            Text(
                                text = if (listState.searchText == null) {
                                    stringResource(id = R.string.ai_history_empty)
                                } else {
                                    stringResource(id = R.string.ai_history_no_search_results)
                                },
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }

                items(
                    items = orderCurrentAiChatFirst(
                        sessions = listState.sessions,
                        currentSessionId = currentSessionId
                    ),
                    key = { summary -> summary.sessionId }
                ) { summary ->
                    val isCurrent = summary.sessionId == currentSessionId
                    AiChatHistoryRow(
                        summary = summary,
                        isCurrent = isCurrent,
                        rowAction = uiState.rowActions[summary.sessionId],
                        rowError = uiState.rowErrors[summary.sessionId],
                        canArchive = isCurrent.not() || isCurrentChatArchiveDisabled.not(),
                        onOpen = { onOpenSession(summary) },
                        onRequestRename = { onRequestRename(summary) },
                        onRequestArchive = { onRequestArchive(summary) }
                    )
                    HorizontalDivider()
                }

                if (listState.nextCursor != null) {
                    item(key = "load_more") {
                        AiChatHistoryLoadMoreRow(
                            loadMoreState = uiState.loadMoreState,
                            onRetry = onLoadMore
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AiChatHistoryLoadMoreEffect(
    lazyListState: LazyListState,
    canLoadMore: Boolean,
    onLoadMore: () -> Unit
) {
    val currentOnLoadMore by rememberUpdatedState(onLoadMore)
    LaunchedEffect(lazyListState, canLoadMore) {
        if (canLoadMore.not()) {
            return@LaunchedEffect
        }

        // Re-fires when a page lands while the end is still visible, never while nothing changes.
        snapshotFlow {
            val layoutInfo = lazyListState.layoutInfo
            val lastVisibleIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            val isNearEnd = lastVisibleIndex >= layoutInfo.totalItemsCount - 1 - aiChatHistoryLoadMoreThreshold
            isNearEnd to layoutInfo.totalItemsCount
        }
            .distinctUntilChanged()
            .filter { (isNearEnd, _) -> isNearEnd }
            .collect {
                currentOnLoadMore()
            }
    }
}

@Composable
private fun AiChatHistoryLoadMoreRow(
    loadMoreState: AiChatHistoryLoadMoreState,
    onRetry: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        if (loadMoreState == AiChatHistoryLoadMoreState.FAILED) {
            Text(
                text = stringResource(id = R.string.ai_history_load_error),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
            TextButton(onClick = onRetry) {
                Text(stringResource(id = R.string.ai_retry))
            }
        } else {
            CircularProgressIndicator(modifier = Modifier.size(24.dp))
        }
    }
}

@Composable
private fun AiChatHistoryRow(
    summary: AiChatSessionHistorySummary,
    isCurrent: Boolean,
    rowAction: AiChatHistoryRowAction?,
    rowError: AiChatHistoryRowError?,
    canArchive: Boolean,
    onOpen: () -> Unit,
    onRequestRename: () -> Unit,
    onRequestArchive: () -> Unit
) {
    var isMenuExpanded by remember(summary.sessionId) { mutableStateOf(value = false) }
    val preview = summary.preview

    Column(modifier = Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = summary.title ?: stringResource(id = R.string.ai_history_untitled_chat),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(weight = 1f, fill = false)
                    )
                    if (isCurrent) {
                        Text(
                            text = stringResource(id = R.string.ai_history_current),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.testTag(tag = aiChatHistoryCurrentMarkerTag)
                        )
                    }
                }
            },
            supportingContent = if (preview != null) {
                {
                    Text(
                        text = preview,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            } else {
                null
            },
            trailingContent = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = DateUtils.getRelativeTimeSpanString(
                            summary.lastActivityAtMillis,
                            System.currentTimeMillis(),
                            DateUtils.MINUTE_IN_MILLIS
                        ).toString(),
                        style = MaterialTheme.typography.labelSmall
                    )
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.size(48.dp)
                    ) {
                        if (rowAction != null) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        } else {
                            IconButton(onClick = { isMenuExpanded = true }) {
                                Icon(
                                    imageVector = Icons.Outlined.MoreVert,
                                    contentDescription = stringResource(
                                        id = R.string.ai_history_more_actions_content_description
                                    )
                                )
                            }
                            DropdownMenu(
                                expanded = isMenuExpanded,
                                onDismissRequest = { isMenuExpanded = false }
                            ) {
                                DropdownMenuItem(
                                    text = {
                                        Text(stringResource(id = R.string.ai_history_rename))
                                    },
                                    onClick = {
                                        isMenuExpanded = false
                                        onRequestRename()
                                    }
                                )
                                DropdownMenuItem(
                                    text = {
                                        Text(stringResource(id = R.string.ai_history_archive))
                                    },
                                    enabled = canArchive,
                                    onClick = {
                                        isMenuExpanded = false
                                        onRequestArchive()
                                    }
                                )
                            }
                        }
                    }
                }
            },
            modifier = Modifier
                .clickable(
                    enabled = rowAction != AiChatHistoryRowAction.ARCHIVING,
                    onClick = onOpen
                )
                .testTag(tag = aiChatHistoryRowTag(sessionId = summary.sessionId))
        )

        if (rowError != null) {
            Text(
                text = stringResource(id = aiChatHistoryRowErrorMessage(rowError = rowError)),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            )
        }
    }
}

@Composable
private fun AiChatHistoryRenameDialog(
    summary: AiChatSessionHistorySummary,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var titleDraft by rememberSaveable(summary.sessionId) { mutableStateOf(value = summary.title.orEmpty()) }
    val canSave = titleDraft.isNotBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(stringResource(id = R.string.ai_history_rename))
        },
        text = {
            OutlinedTextField(
                value = titleDraft,
                onValueChange = { value ->
                    titleDraft = value.take(n = aiChatSessionTitleMaximumLength)
                },
                label = {
                    Text(stringResource(id = R.string.ai_history_rename_field_label))
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(titleDraft) },
                enabled = canSave
            ) {
                Text(stringResource(id = R.string.ai_history_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(id = R.string.ai_cancel))
            }
        }
    )
}

@Composable
private fun AiChatHistoryStatus(
    modifier: Modifier,
    content: @Composable () -> Unit
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.padding(24.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            content()
        }
    }
}

private fun aiChatHistoryRowErrorMessage(rowError: AiChatHistoryRowError): Int {
    return when (rowError) {
        AiChatHistoryRowError.RENAME_FAILED -> R.string.ai_history_rename_error
        AiChatHistoryRowError.ARCHIVE_FAILED -> R.string.ai_history_archive_error
        AiChatHistoryRowError.ARCHIVE_ACTIVE_RUN -> R.string.ai_history_archive_active_run_error
    }
}

private fun orderCurrentAiChatFirst(
    sessions: List<AiChatSessionHistorySummary>,
    currentSessionId: String?
): List<AiChatSessionHistorySummary> {
    return sessions.filter { session -> session.sessionId == currentSessionId } +
        sessions.filter { session -> session.sessionId != currentSessionId }
}
