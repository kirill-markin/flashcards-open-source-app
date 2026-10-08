package com.flashcardsopensourceapp.feature.ai.history

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionHistorySummary
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryReaderBackButtonTag
import com.flashcardsopensourceapp.feature.ai.aiChatHistoryReaderTag
import com.flashcardsopensourceapp.feature.ai.ui.MessageRow

/** A read-only old chat: the server refuses new turns in it, so there is no composer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatHistoryReaderRoute(
    /** The list row this chat was opened from; null when the list no longer holds it. */
    summary: AiChatSessionHistorySummary?,
    readerState: AiChatHistoryReaderState,
    onRetry: () -> Unit,
    onOpenAccountStatus: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = summary?.title ?: stringResource(id = R.string.ai_history_untitled_chat),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier.testTag(tag = aiChatHistoryReaderBackButtonTag)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.ai_history_back_content_description)
                        )
                    }
                }
            )
        },
        bottomBar = {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = stringResource(id = R.string.ai_history_read_only_notice),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )
            }
        }
    ) { innerPadding ->
        val contentModifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)
            .testTag(tag = aiChatHistoryReaderTag)

        when (readerState) {
            AiChatHistoryReaderState.Loading -> {
                AiChatHistoryReaderStatus(modifier = contentModifier) {
                    CircularProgressIndicator()
                    Text(stringResource(id = R.string.ai_history_reader_loading))
                }
            }

            AiChatHistoryReaderState.Unavailable -> {
                AiChatHistoryReaderStatus(modifier = contentModifier) {
                    Text(
                        text = stringResource(id = R.string.ai_history_unavailable),
                        textAlign = TextAlign.Center
                    )
                }
            }

            AiChatHistoryReaderState.Failed -> {
                AiChatHistoryReaderStatus(modifier = contentModifier) {
                    Text(
                        text = stringResource(id = R.string.ai_history_reader_load_error),
                        textAlign = TextAlign.Center
                    )
                    Button(onClick = onRetry) {
                        Text(stringResource(id = R.string.ai_retry))
                    }
                }
            }

            is AiChatHistoryReaderState.Loaded -> {
                AiChatHistoryReaderMessages(
                    messages = readerState.messages,
                    onOpenAccountStatus = onOpenAccountStatus,
                    modifier = contentModifier
                )
            }
        }
    }
}

@Composable
private fun AiChatHistoryReaderMessages(
    messages: List<AiChatMessage>,
    onOpenAccountStatus: () -> Unit,
    modifier: Modifier
) {
    val lazyListState = rememberLazyListState()

    // Opens on the latest messages, like the live chat.
    LaunchedEffect(lazyListState) {
        if (messages.isNotEmpty()) {
            lazyListState.scrollToItem(index = messages.lastIndex)
        }
    }

    LazyColumn(
        state = lazyListState,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier
    ) {
        items(items = messages, key = { message -> message.messageId }) { message ->
            MessageRow(
                message = message,
                isStreaming = false,
                isLastMessage = messages.lastOrNull()?.messageId == message.messageId,
                onOpenAccountStatus = onOpenAccountStatus
            )
        }
    }
}

@Composable
private fun AiChatHistoryReaderStatus(
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
