package com.flashcardsopensourceapp.feature.ai.ui

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
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.buildAiChatCardContextXml
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusToken
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider
import com.flashcardsopensourceapp.feature.ai.toolcall.ToolCallCard

@Composable
internal fun MessageRow(
    message: AiChatMessage,
    isStreaming: Boolean,
    isLastMessage: Boolean,
    onOpenAccountStatus: () -> Unit
) {
    val context = LocalContext.current
    val textProvider = remember(context) { aiTextProvider(context = context) }
    val alignment = if (message.role == AiChatRole.USER) Alignment.CenterEnd else Alignment.CenterStart
    val containerColor = if (message.role == AiChatRole.USER) {
        MaterialTheme.colorScheme.primaryContainer
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
                        textProvider = textProvider,
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
                    textProvider = textProvider,
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
    textProvider: AiTextProvider,
    modifier: Modifier
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier
    ) {
        Text(
            text = if (message.role == AiChatRole.USER) {
                stringResource(id = R.string.ai_you)
            } else {
                stringResource(id = R.string.ai_title)
            },
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold
        )

        message.content.forEach { contentPart ->
            when (contentPart) {
                is AiChatContentPart.Text -> {
                    if (showsStreamingIndicator && contentPart.text == aiChatOptimisticAssistantStatusToken) {
                        TypingIndicatorRow()
                    } else {
                        SelectionContainer {
                            Text(
                                text = if (contentPart.text == aiChatOptimisticAssistantStatusToken) {
                                    textProvider.optimisticAssistantStatusText
                                } else {
                                    contentPart.text
                                },
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
                    ReasoningSummaryCard(reasoningSummary = contentPart.reasoningSummary)
                }

                is AiChatContentPart.Image -> {
                    AttachmentContentCard(
                        title = contentPart.fileName ?: stringResource(id = R.string.ai_image_attachment_title),
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

                is AiChatContentPart.Card -> {
                    CardContextContentCard(
                        cardId = contentPart.cardId,
                        frontText = contentPart.frontText,
                        backText = contentPart.backText,
                        tags = contentPart.tags,
                        effortLevel = contentPart.effortLevel,
                        textProvider = textProvider
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

                is AiChatContentPart.Unknown -> {
                    AttachmentContentCard(
                        title = contentPart.summaryText,
                        subtitle = stringResource(
                            id = R.string.ai_unknown_type_subtitle,
                            bidiWrap(
                                text = contentPart.originalType,
                                locale = locale
                            )
                        ),
                        icon = Icons.Outlined.WarningAmber
                    )
                }
            }
        }

        if (showsStreamingIndicator && message.content.none { contentPart ->
                contentPart is AiChatContentPart.Text && contentPart.text == aiChatOptimisticAssistantStatusToken
            }
        ) {
            TypingIndicatorRow()
        }
    }
}

@Composable
private fun ReasoningSummaryCard(reasoningSummary: AiChatReasoningSummary) {
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
                text = if (reasoningSummary.status == AiChatToolCallStatus.STARTED) {
                    stringResource(id = R.string.ai_reasoning_summary_running)
                } else {
                    stringResource(id = R.string.ai_reasoning_summary_done)
                },
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            SelectionContainer {
                Text(
                    text = reasoningSummary.summary.ifBlank {
                        stringResource(id = R.string.ai_thinking)
                    },
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
private fun CardContextContentCard(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>,
    effortLevel: com.flashcardsopensourceapp.data.local.model.EffortLevel,
    textProvider: AiTextProvider
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    var isPromptContextVisible by remember { mutableStateOf(value = false) }
    val promptContextXml = buildAiChatCardContextXml(
        cardId = cardId,
        frontText = frontText,
        backText = backText,
        tags = tags,
        effortLevel = effortLevel
    )

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Outlined.CollectionsBookmark,
                    contentDescription = null
                )
                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = aiCardAttachmentLabel(frontText = frontText),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = stringResource(
                            id = R.string.ai_card_id_label,
                            bidiWrap(
                                text = cardId,
                                locale = locale
                            )
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (tags.isNotEmpty()) {
                Text(
                    text = stringResource(
                        id = R.string.ai_card_tags_label,
                        bidiWrap(
                            text = tags.joinToString(separator = ", "),
                            locale = locale
                        )
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Text(
                text = stringResource(
                    id = R.string.ai_card_effort_label,
                    bidiWrap(
                        text = textProvider.effortLabel(effortLevel = effortLevel),
                        locale = locale
                    )
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            TextButton(
                onClick = {
                    isPromptContextVisible = isPromptContextVisible.not()
                }
            ) {
                Text(
                    if (isPromptContextVisible) {
                        stringResource(id = R.string.ai_hide_prompt_context)
                    } else {
                        stringResource(id = R.string.ai_show_prompt_context)
                    }
                )
            }

            if (isPromptContextVisible) {
                SelectionContainer {
                    Text(
                        text = promptContextXml,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
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
            text = stringResource(id = R.string.ai_generating_response),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
internal fun RepairStatusCard(
    status: AiChatRepairAttemptStatus,
    textProvider: AiTextProvider
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

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
                text = stringResource(id = R.string.ai_repairing_response),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = status.message,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = stringResource(
                    id = R.string.ai_attempt_of_max,
                    status.attempt,
                    status.maxAttempts
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer
            )
            status.toolName?.let { toolName ->
                Text(
                    text = stringResource(
                        id = R.string.ai_tool_label,
                        bidiWrap(
                            text = textProvider.toolLabel(name = toolName),
                            locale = locale
                        )
                    ),
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

@Composable
private fun aiCardAttachmentLabel(frontText: String): String {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    val trimmedFrontText = frontText.trim()
    if (trimmedFrontText.isEmpty()) {
        return stringResource(id = R.string.ai_card_attachment_fallback_title)
    }

    return stringResource(
        id = R.string.ai_card_attachment_title,
        bidiWrap(
            text = trimmedFrontText.take(n = 72),
            locale = locale
        )
    )
}
