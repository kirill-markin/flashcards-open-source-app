package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText

const val aiAssistantMessageBubbleTag: String = "ai_assistant_message_bubble"
const val aiAssistantTextPartTag: String = "ai_assistant_text_part"

@Composable
internal fun MessageRow(
    message: AiChatMessage,
    isStreaming: Boolean,
    isLastMessage: Boolean,
    onOpenAccountStatus: () -> Unit
) {
    val alignment = if (message.role == AiChatRole.USER) Alignment.CenterEnd else Alignment.CenterStart
    val containerColor = if (message.role == AiChatRole.USER) {
        MaterialTheme.colorScheme.primaryContainer
    } else if (message.isError) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }
    val showsStreamingIndicator = message.role == AiChatRole.ASSISTANT
        && isLastMessage
        && isStreaming

    Box(
        contentAlignment = alignment,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (message.role == AiChatRole.USER) {
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = containerColor),
                    modifier = Modifier
                        .align(alignment = Alignment.CenterEnd)
                        .widthIn(max = maxWidth * 0.88f)
                        .testTag(tag = aiUserMessageBubbleTag)
                ) {
                    MessageBubbleContent(
                        message = message,
                        showsStreamingIndicator = showsStreamingIndicator,
                        onOpenAccountStatus = onOpenAccountStatus,
                        modifier = Modifier.padding(all = 16.dp)
                    )
                }
            }
        } else {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = aiAssistantMessageBubbleTag)
            ) {
                MessageBubbleContent(
                    message = message,
                    showsStreamingIndicator = showsStreamingIndicator,
                    onOpenAccountStatus = onOpenAccountStatus,
                    modifier = Modifier
                        .background(color = containerColor)
                        .padding(all = 16.dp)
                )
            }
        }
    }
}

@Composable
private fun MessageBubbleContent(
    message: AiChatMessage,
    showsStreamingIndicator: Boolean,
    onOpenAccountStatus: () -> Unit,
    modifier: Modifier
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier
    ) {
        Text(
            text = if (message.role == AiChatRole.USER) "You" else "AI",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold
        )

        message.content.forEach { contentPart ->
            when (contentPart) {
                is AiChatContentPart.Text -> {
                    if (showsStreamingIndicator && contentPart.text == aiChatOptimisticAssistantStatusText) {
                        TypingIndicatorRow()
                    } else {
                        SelectionContainer {
                            Text(
                                text = contentPart.text,
                                modifier = if (message.role == AiChatRole.ASSISTANT) {
                                    Modifier.testTag(tag = aiAssistantTextPartTag)
                                } else {
                                    Modifier
                                }
                            )
                        }
                    }
                }

                is AiChatContentPart.ReasoningSummary -> {
                    ReasoningSummaryCard(summary = contentPart.summary)
                }

                is AiChatContentPart.Image -> {
                    AttachmentContentCard(
                        title = contentPart.fileName ?: "Image attachment",
                        subtitle = contentPart.mediaType,
                        icon = Icons.Outlined.Image
                    )
                }

                is AiChatContentPart.File -> {
                    AttachmentContentCard(
                        title = contentPart.fileName,
                        subtitle = contentPart.mediaType,
                        icon = Icons.Outlined.Description
                    )
                }

                is AiChatContentPart.ToolCall -> {
                    ToolCallCard(toolCall = contentPart.toolCall)
                }

                is AiChatContentPart.AccountUpgradePrompt -> {
                    AccountUpgradeCard(
                        message = contentPart.message,
                        buttonTitle = contentPart.buttonTitle,
                        onOpenAccountStatus = onOpenAccountStatus
                    )
                }
            }
        }

        if (showsStreamingIndicator && message.content.none { contentPart ->
                contentPart is AiChatContentPart.Text && contentPart.text == aiChatOptimisticAssistantStatusText
            }
        ) {
            TypingIndicatorRow()
        }
    }
}

@Composable
private fun ReasoningSummaryCard(summary: String) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Reasoning summary",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            SelectionContainer {
                Text(
                    text = summary,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

@Composable
private fun AttachmentContentCard(
    title: String,
    subtitle: String,
    icon: ImageVector
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        ListItem(
            headlineContent = {
                Text(title)
            },
            supportingContent = {
                Text(subtitle)
            },
            leadingContent = {
                Icon(icon, contentDescription = null)
            }
        )
    }
}

@Composable
private fun TypingIndicatorRow() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(
            strokeWidth = 2.dp,
            modifier = Modifier.width(18.dp)
        )
        Text(
            text = "Generating response...",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
internal fun RepairStatusCard(status: AiChatRepairAttemptStatus) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.tertiaryContainer
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Repairing AI response",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = status.message,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "Attempt ${status.attempt} of ${status.maxAttempts}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer
            )
            status.toolName?.let { toolName ->
                Text(
                    text = "Tool: $toolName",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer
                )
            }
        }
    }
}

@Composable
private fun AccountUpgradeCard(
    message: String,
    buttonTitle: String,
    onOpenAccountStatus: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            SelectionContainer {
                Text(text = message)
            }
            Button(
                onClick = onOpenAccountStatus,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(buttonTitle)
            }
        }
    }
}
