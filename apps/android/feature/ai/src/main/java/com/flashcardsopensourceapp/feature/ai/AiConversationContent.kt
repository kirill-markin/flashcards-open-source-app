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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
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
    var isDetachedFromBottom by rememberSaveable {
        mutableStateOf(false)
    }
    val scrollConnection = remember(listState) {
        object : NestedScrollConnection {
            override fun onPostScroll(
                consumed: Offset,
                available: Offset,
                source: NestedScrollSource
            ): Offset {
                if (source == NestedScrollSource.UserInput) {
                    // Only user-driven scrolling should toggle the detach latch.
                    isDetachedFromBottom = aiConversationScrollState(
                        layoutInfo = listState.layoutInfo,
                        bottomThresholdPx = aiConversationAutoScrollBottomThresholdPx
                    ).isNearBottom.not()
                }

                return Offset.Zero
            }
        }
    }

    suspend fun scrollLatestContentIfNeeded(
        messagesSnapshot: List<AiChatMessage>,
        isAnimated: Boolean
    ) {
        if (messagesSnapshot.isEmpty() || isDetachedFromBottom) {
            return
        }

        val scrollState = aiConversationScrollState(
            layoutInfo = listState.layoutInfo,
            bottomThresholdPx = aiConversationAutoScrollBottomThresholdPx
        )
        if (scrollState.isNearBottom) {
            return
        }

        if (isAnimated) {
            listState.animateScrollToItem(index = conversationLastItemIndex(messages = messagesSnapshot))
        } else {
            listState.scrollToItem(index = conversationLastItemIndex(messages = messagesSnapshot))
        }
    }

    LaunchedEffect(messages, isDetachedFromBottom) {
        if (messages.isNotEmpty()) {
            scrollLatestContentIfNeeded(
                messagesSnapshot = messages,
                isAnimated = isStreaming.not()
            )
        }
    }

    LaunchedEffect(isStreaming, messages.isEmpty()) {
        if (messages.isNotEmpty()) {
            while (currentStreamingState) {
                delay(250L)
                scrollLatestContentIfNeeded(
                    messagesSnapshot = currentMessages,
                    isAnimated = true
                )
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
                modifier = Modifier
                    .fillMaxSize()
                    .nestedScroll(scrollConnection)
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
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
            .widthIn(max = aiEmptyStateMaxWidth)
            .testTag(aiEmptyStateContentTag)
    ) {
        Text(
            text = stringResource(id = R.string.ai_empty_title),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center
        )
        Text(
            text = stringResource(
                id = R.string.ai_empty_body,
                bidiWrap(
                    text = currentWorkspaceName,
                    locale = locale
                )
            ),
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
