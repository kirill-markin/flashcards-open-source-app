package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import kotlinx.coroutines.delay

private val aiEmptyStateMaxWidth = 420.dp
const val aiConversationSurfaceTag: String = "ai_conversation_surface"

@Composable
internal fun AiConversation(
    messages: List<AiChatMessage>,
    currentWorkspaceName: String,
    isStreaming: Boolean,
    onOpenAccountStatus: () -> Unit,
    onDismissComposerFocus: () -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier
) {
    val listState = rememberLazyListState()
    val currentMessages by rememberUpdatedState(messages)
    val currentStreamingState by rememberUpdatedState(isStreaming)
    val interactionSource = remember { MutableInteractionSource() }
    val autoScrollKey = remember(messages) {
        buildString {
            append(messages.size)
            val lastMessage = messages.lastOrNull()
            if (lastMessage != null) {
                append("|")
                append(lastMessage.messageId)
                append("|")
                append(lastMessage.isError)
                append("|")
                append(
                    lastMessage.content.sumOf { contentPart ->
                        when (contentPart) {
                            is AiChatContentPart.Text -> contentPart.text.length
                            is AiChatContentPart.ReasoningSummary -> contentPart.reasoningSummary.summary.length
                            is AiChatContentPart.ToolCall -> contentPart.toolCall.input?.length ?: 0
                            is AiChatContentPart.Image -> contentPart.base64Data.length
                            is AiChatContentPart.File -> contentPart.base64Data.length
                            is AiChatContentPart.AccountUpgradePrompt -> contentPart.message.length
                        }
                    }
                )
            }
        }
    }

    LaunchedEffect(autoScrollKey, messages.isEmpty()) {
        if (messages.isNotEmpty()) {
            val layoutInfo = listState.layoutInfo
            val lastVisibleItemIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val scrollState = aiConversationScrollState(
                totalItemsCount = layoutInfo.totalItemsCount,
                lastVisibleItemIndex = lastVisibleItemIndex,
                isUserScrolling = listState.isScrollInProgress,
                bottomThreshold = 1
            )
            if (scrollState.isNearBottom && scrollState.isUserScrolling.not()) {
                listState.animateScrollToItem(index = conversationLastItemIndex(messages = messages))
            }
        }
    }

    LaunchedEffect(isStreaming, messages.isEmpty()) {
        if (messages.isNotEmpty()) {
            while (currentStreamingState) {
                delay(250L)
                val layoutInfo = listState.layoutInfo
                val lastVisibleItemIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
                val scrollState = aiConversationScrollState(
                    totalItemsCount = layoutInfo.totalItemsCount,
                    lastVisibleItemIndex = lastVisibleItemIndex,
                    isUserScrolling = listState.isScrollInProgress,
                    bottomThreshold = 1
                )
                if (scrollState.isNearBottom && scrollState.isUserScrolling.not()) {
                    listState.animateScrollToItem(index = conversationLastItemIndex(messages = currentMessages))
                }
            }
        }
    }

    Box(
        modifier = modifier
            .clipToBounds()
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onDismissComposerFocus
            )
            .testTag(aiConversationSurfaceTag)
    ) {
        if (messages.isEmpty()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(contentPadding)
                    .testTag(aiEmptyStateTag)
            ) {
                AiConversationEmptyState(
                    currentWorkspaceName = currentWorkspaceName,
                    modifier = Modifier
                )
            }
        } else {
            LazyColumn(
                state = listState,
                contentPadding = contentPadding,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(items = messages, key = { message -> message.messageId }) { message ->
                    MessageRow(
                        message = message,
                        isStreaming = isStreaming,
                        isLastMessage = messages.lastOrNull()?.messageId == message.messageId,
                        onOpenAccountStatus = onOpenAccountStatus
                    )
                }
            }
        }
    }
}

@Composable
private fun AiConversationEmptyState(
    currentWorkspaceName: String,
    modifier: Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
            .widthIn(max = aiEmptyStateMaxWidth)
            .testTag(aiEmptyStateContentTag)
    ) {
        Text(
            text = "Try asking",
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center
        )
        Text(
            text = "Summarize weak areas from my due cards in $currentWorkspaceName.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Text(
            text = "Find cards tagged with grammar and suggest cleanup.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Text(
            text = "Propose a new deck filter and explain the exact change.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

private fun conversationLastItemIndex(messages: List<AiChatMessage>): Int {
    if (messages.isEmpty()) {
        throw IllegalArgumentException("Conversation list requires at least one message.")
    }

    return messages.lastIndex
}
