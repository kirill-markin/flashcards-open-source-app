package com.flashcardsopensourceapp.feature.ai.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.content.MathText
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRole
import com.flashcardsopensourceapp.data.local.model.ai.aiChatOptimisticAssistantStatusToken
import com.flashcardsopensourceapp.data.local.model.ai.buildAiChatCardContextXml
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider
import com.flashcardsopensourceapp.feature.ai.toolcall.AiTranscriptDisclosureRow
import com.flashcardsopensourceapp.feature.ai.toolcall.ToolCallCard
import com.flashcardsopensourceapp.feature.ai.toolcall.aiTranscriptRowIndent

private val aiTypingIndicatorHeight = 20.dp
private val aiTypingIndicatorDotSize = 6.dp
private val aiTypingIndicatorDotSpacing = 5.dp
private const val aiTypingIndicatorDotCount = 3
private const val aiTypingIndicatorStepMillis = 300
private const val aiTypingIndicatorActiveDotAlpha = 1f
private const val aiTypingIndicatorInactiveDotAlpha = 0.25f

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
    val hasOptimisticAssistantStatus = message.content.any { contentPart ->
        contentPart is AiChatContentPart.Text && contentPart.text == aiChatOptimisticAssistantStatusToken
    }
    val canShowOptimisticIndicator = hasOptimisticAssistantStatus &&
        message.isError.not() &&
        message.isStopped.not()
    val showsStreamingIndicator = message.role == AiChatRole.ASSISTANT
        && isLastMessage
        && (isStreaming || canShowOptimisticIndicator)
    val isRunActive = message.role == AiChatRole.ASSISTANT && isLastMessage && isStreaming

    Box(
        contentAlignment = alignment,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (message.role == AiChatRole.USER) {
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    modifier = Modifier
                        .align(alignment = Alignment.CenterEnd)
                        .widthIn(max = maxWidth * 0.88f)
                        .testTag(tag = aiUserMessageBubbleTag)
                ) {
                    MessageBubbleContent(
                        message = message,
                        showsStreamingIndicator = showsStreamingIndicator,
                        isRunActive = isRunActive,
                        onOpenAccountStatus = onOpenAccountStatus,
                        textProvider = textProvider,
                        modifier = Modifier.padding(all = 16.dp)
                    )
                }
            }
        } else {
            MessageBubbleContent(
                message = message,
                showsStreamingIndicator = showsStreamingIndicator,
                isRunActive = isRunActive,
                onOpenAccountStatus = onOpenAccountStatus,
                textProvider = textProvider,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = aiAssistantMessageBubbleTag)
                    .padding(vertical = 4.dp)
            )
        }
    }
}

@Composable
private fun MessageBubbleContent(
    message: AiChatMessage,
    showsStreamingIndicator: Boolean,
    isRunActive: Boolean,
    onOpenAccountStatus: () -> Unit,
    textProvider: AiTextProvider,
    modifier: Modifier
) {
    val sections = if (message.role == AiChatRole.ASSISTANT) {
        splitAssistantMessageSections(content = message.content)
    } else {
        null
    }
    val contentPartRow: @Composable (AiChatContentPart) -> Unit = { contentPart ->
        MessageContentPart(
            contentPart = contentPart,
            message = message,
            showsStreamingIndicator = showsStreamingIndicator,
            onOpenAccountStatus = onOpenAccountStatus,
            textProvider = textProvider
        )
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier
    ) {
        if (sections == null) {
            message.content.forEach { contentPart -> contentPartRow(contentPart) }
        } else {
            AiWorkBlock(
                message = message,
                sections = sections,
                isRunActive = isRunActive,
                workPartContent = contentPartRow,
                modifier = Modifier
            )
            sections.answerParts.forEach { contentPart -> contentPartRow(contentPart) }
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
private fun MessageContentPart(
    contentPart: AiChatContentPart,
    message: AiChatMessage,
    showsStreamingIndicator: Boolean,
    onOpenAccountStatus: () -> Unit,
    textProvider: AiTextProvider
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

    when (contentPart) {
        is AiChatContentPart.Text -> {
            if (contentPart.text == aiChatOptimisticAssistantStatusToken) {
                if (showsStreamingIndicator) {
                    TypingIndicatorRow()
                }
            } else {
                SelectionContainer {
                    AiMarkdownText(
                        text = textProvider.chatErrorText(
                            errorCode = message.errorCode,
                            storedText = contentPart.text
                        ),
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
            ReasoningSummaryRow(reasoningSummary = contentPart.reasoningSummary)
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
                tags = contentPart.tags
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

@Composable
private fun ReasoningSummaryRow(reasoningSummary: AiChatReasoningSummary) {
    var isExpanded by rememberSaveable(reasoningSummary.reasoningId) {
        mutableStateOf(value = false)
    }
    val thinkingText = stringResource(id = R.string.ai_thinking)

    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        AiTranscriptDisclosureRow(
            label = reasoningSummaryHeadline(summary = reasoningSummary.summary).ifBlank { thinkingText },
            status = reasoningSummary.status,
            isExpanded = isExpanded,
            onClickLabel = null,
            onToggle = {
                isExpanded = isExpanded.not()
            },
            labelModifier = Modifier,
            statusModifier = Modifier,
            modifier = Modifier
        )
        if (isExpanded) {
            SelectionContainer {
                MathText(
                    text = reasoningSummary.summary.ifBlank { thinkingText },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = aiTranscriptRowIndent)
                )
            }
        }
    }
}

/**
 * The collapsed reasoning line shows the summary's first line, which the model usually writes
 * as a bold or heading title, without its markdown markers.
 */
private fun reasoningSummaryHeadline(summary: String): String {
    val firstLine = summary.lineSequence()
        .map { line -> line.trim() }
        .firstOrNull { line -> line.isNotEmpty() }
        ?: return ""
    return firstLine.trimStart('#').trim().trim('*').trim()
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
    tags: List<String>
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    var isPromptContextVisible by remember { mutableStateOf(value = false) }
    val promptContextXml = buildAiChatCardContextXml(
        cardId = cardId,
        frontText = frontText,
        backText = backText,
        tags = tags
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
                    MathText(
                        text = frontText,
                        formatText = cardAttachmentTextFormatter(),
                        maxLines = 2,
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
    val indicatorLabel = stringResource(id = R.string.ai_generating_response)
    val dotColor = MaterialTheme.colorScheme.onSurfaceVariant
    val transition = rememberInfiniteTransition(label = "aiTypingIndicator")
    val activeDotProgress by transition.animateFloat(
        initialValue = 0f,
        targetValue = aiTypingIndicatorDotCount.toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = aiTypingIndicatorDotCount * aiTypingIndicatorStepMillis,
                easing = LinearEasing
            )
        ),
        label = "aiTypingIndicatorActiveDot"
    )

    Row(
        horizontalArrangement = Arrangement.spacedBy(aiTypingIndicatorDotSpacing),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .height(height = aiTypingIndicatorHeight)
            .semantics {
                contentDescription = indicatorLabel
                progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
            }
    ) {
        repeat(times = aiTypingIndicatorDotCount) { dotIndex ->
            Box(
                modifier = Modifier
                    .size(size = aiTypingIndicatorDotSize)
                    .graphicsLayer {
                        val activeDotIndex = activeDotProgress.toInt() % aiTypingIndicatorDotCount
                        alpha = if (activeDotIndex == dotIndex) {
                            aiTypingIndicatorActiveDotAlpha
                        } else {
                            aiTypingIndicatorInactiveDotAlpha
                        }
                    }
                    .background(
                        color = dotColor,
                        shape = CircleShape
                    )
            )
        }
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
private fun cardAttachmentTextFormatter(): (String) -> String {
    val resources = LocalResources.current
    val locale = currentResourceLocale(resources = resources)
    return { text ->
        if (text.isBlank()) {
            resources.getString(R.string.ai_card_attachment_fallback_title)
        } else {
            resources.getString(
                R.string.ai_card_attachment_title,
                bidiWrap(text = text.trim().take(72), locale = locale)
            )
        }
    }
}
