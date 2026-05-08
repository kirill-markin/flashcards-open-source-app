package com.flashcardsopensourceapp.feature.ai.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.ai.AiUiState
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerPendingAttachmentTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSuggestionPrefixTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSuggestionRowTag
import com.flashcardsopensourceapp.feature.ai.input.dictationStatusLabel
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider

private val aiComposerActionSize = 40.dp
private val aiComposerPrimaryActionSize = 36.dp
private val aiComposerProgressSize = 16.dp
private const val aiComposerMaximumLineCount = 5

@Composable
internal fun AiComposer(
    uiState: AiUiState,
    onDraftMessageChange: (String) -> Unit,
    onApplyComposerSuggestion: (com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion) -> Unit,
    onSendMessage: () -> Unit,
    onCancelStreaming: () -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onOpenAttachmentMenu: () -> Unit,
    onToggleDictation: () -> Unit,
    modifier: Modifier
) {
    val context = LocalContext.current
    val textProvider = remember(context) { aiTextProvider(context = context) }
    val focusRequester = remember { FocusRequester() }
    val providerAndModelLabel = "${uiState.chatConfig.provider.label} · ${uiState.chatConfig.model.badgeLabel}"
    val primaryActionLabel = stringResource(
        id = if (uiState.canStopStreaming) {
            R.string.ai_stop
        } else {
            R.string.ai_send
        }
    )
    val dictationActionLabel = stringResource(
        id = if (uiState.dictationState == AiChatDictationState.RECORDING) {
            R.string.ai_stop
        } else {
            R.string.ai_dictate
        }
    )
    val attachActionLabel = stringResource(id = R.string.ai_attach)

    LaunchedEffect(uiState.focusComposerRequestVersion) {
        if (uiState.focusComposerRequestVersion > 0L) {
            focusRequester.requestFocus()
        }
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .imePadding(),
        tonalElevation = 2.dp
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            if (uiState.pendingAttachments.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(state = rememberScrollState())
                ) {
                    uiState.pendingAttachments.forEach { attachment ->
                        FilterChip(
                            selected = true,
                            onClick = {},
                            modifier = Modifier.testTag(tag = aiComposerPendingAttachmentTag),
                            label = {
                                Text(
                                    text = when (attachment) {
                                        is AiChatAttachment.Binary -> attachment.fileName
                                        is AiChatAttachment.Card -> aiCardAttachmentLabel(
                                            frontText = attachment.frontText
                                        )
                                        is AiChatAttachment.Unknown -> attachment.summaryText
                                    },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = when (attachment) {
                                        is AiChatAttachment.Binary -> {
                                            if (attachment.isImage) {
                                                Icons.Outlined.Image
                                            } else {
                                                Icons.Outlined.Description
                                            }
                                        }

                                        is AiChatAttachment.Card -> Icons.Outlined.CollectionsBookmark
                                        is AiChatAttachment.Unknown -> Icons.Outlined.WarningAmber
                                    },
                                    contentDescription = null
                                )
                            },
                            trailingIcon = {
                                IconButton(
                                    onClick = {
                                        onRemovePendingAttachment(attachment.id)
                                    },
                                    enabled = uiState.canManageDraftAttachments,
                                    modifier = Modifier.size(aiComposerActionSize)
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Close,
                                        contentDescription = stringResource(id = R.string.ai_remove_attachment_content_description)
                                    )
                                }
                            }
                        )
                    }
                }
            }

            if (uiState.composerSuggestions.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(state = rememberScrollState())
                        .testTag(tag = aiComposerSuggestionRowTag)
                ) {
                    uiState.composerSuggestions.forEachIndexed { index, suggestion ->
                        AssistChip(
                            onClick = {
                                onApplyComposerSuggestion(suggestion)
                            },
                            label = {
                                Text(
                                    text = suggestion.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            },
                            modifier = Modifier.testTag(tag = "$aiComposerSuggestionPrefixTag$index")
                        )
                    }
                }
            }

            uiState.repairStatus?.let { status ->
                RepairStatusCard(
                    status = status,
                    textProvider = textProvider
                )
            }

            OutlinedTextField(
                value = uiState.draftMessage,
                onValueChange = onDraftMessageChange,
                label = {
                    Text(stringResource(id = R.string.ai_message_label))
                },
                minLines = 1,
                maxLines = aiComposerMaximumLineCount,
                enabled = uiState.canEditDraftText,
                trailingIcon = {
                    FilledIconButton(
                        onClick = if (uiState.canStopStreaming) {
                            onCancelStreaming
                        } else {
                            onSendMessage
                        },
                        enabled = uiState.canStopStreaming || uiState.canSend,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = if (uiState.canStopStreaming) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                            contentColor = if (uiState.canStopStreaming) {
                                MaterialTheme.colorScheme.onError
                            } else {
                                MaterialTheme.colorScheme.onPrimary
                            }
                        ),
                        modifier = Modifier
                            .size(aiComposerPrimaryActionSize)
                            .semantics {
                                contentDescription = primaryActionLabel
                            }
                            .testTag(tag = aiComposerSendButtonTag)
                    ) {
                        Icon(
                            imageVector = if (uiState.canStopStreaming) {
                                Icons.Outlined.Stop
                            } else {
                                Icons.AutoMirrored.Outlined.Send
                            },
                            contentDescription = null
                        )
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester)
                    .testTag(tag = aiComposerMessageFieldTag)
            )

            if (uiState.dictationState != AiChatDictationState.IDLE) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (uiState.dictationState == AiChatDictationState.RECORDING) {
                        Icon(
                            imageVector = Icons.Outlined.Mic,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                    } else {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(aiComposerProgressSize)
                        )
                    }

                    Text(
                        text = dictationStatusLabel(
                            dictationState = uiState.dictationState,
                            textProvider = textProvider
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = providerAndModelLabel,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )

                if (uiState.isStreaming) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(aiComposerProgressSize)
                    )
                }

                IconButton(
                    onClick = onOpenAttachmentMenu,
                    enabled = uiState.canAddDraftAttachment,
                    modifier = Modifier.size(aiComposerActionSize)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.AttachFile,
                        contentDescription = attachActionLabel
                    )
                }

                IconButton(
                    onClick = onToggleDictation,
                    enabled = uiState.canToggleDictation,
                    modifier = Modifier.size(aiComposerActionSize)
                ) {
                    Icon(
                        imageVector = if (uiState.dictationState == AiChatDictationState.RECORDING) {
                            Icons.Outlined.Stop
                        } else {
                            Icons.Outlined.Mic
                        },
                        contentDescription = dictationActionLabel,
                        tint = if (uiState.dictationState == AiChatDictationState.RECORDING) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        }
                    )
                }
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
