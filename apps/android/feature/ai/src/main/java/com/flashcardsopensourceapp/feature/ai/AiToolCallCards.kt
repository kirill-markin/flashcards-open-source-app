package com.flashcardsopensourceapp.feature.ai

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall

@Composable
internal fun ToolCallCard(toolCall: AiChatToolCall) {
    val context = LocalContext.current
    val textProvider = remember(context) { aiTextProvider(context = context) }
    val clipboardManager = remember(context) {
        checkNotNull(context.getSystemService(ClipboardManager::class.java)) {
            "ClipboardManager is not available."
        }
    }
    var isExpanded by rememberSaveable(toolCall.toolCallId) {
        mutableStateOf(value = false)
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 2.dp,
        modifier = Modifier.testTag(tag = aiToolCallCardTag)
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(14.dp)
        ) {
            ListItem(
                headlineContent = {
                    Text(
                        text = formatAiToolCallSummaryText(
                            name = toolCall.name,
                            input = toolCall.input,
                            textProvider = textProvider
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag(tag = aiToolCallSummaryTag)
                    )
                },
                supportingContent = {
                    Text(
                        text = formatAiToolCallStatus(status = toolCall.status, textProvider = textProvider),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.testTag(tag = aiToolCallStatusTag)
                    )
                },
                trailingContent = {
                    IconButton(
                        onClick = {
                            isExpanded = isExpanded.not()
                        },
                        modifier = Modifier.testTag(tag = aiToolCallExpandButtonTag)
                    ) {
                        Icon(
                            imageVector = if (isExpanded) {
                                Icons.Outlined.ExpandLess
                            } else {
                                Icons.Outlined.ExpandMore
                            },
                            contentDescription = if (isExpanded) {
                                stringResource(id = R.string.ai_tool_collapse_details)
                            } else {
                                stringResource(id = R.string.ai_tool_expand_details)
                            }
                        )
                    }
                },
                modifier = Modifier.clickable {
                    isExpanded = isExpanded.not()
                }
            )

            if (isExpanded) {
                toolCall.input?.let { input ->
                    ToolCallDetailCard(
                        title = stringResource(id = R.string.ai_tool_input),
                        copyTitle = stringResource(id = R.string.ai_tool_copy_input),
                        value = input,
                        valueTag = aiToolCallInputTag,
                        onCopy = {
                            clipboardManager.setPrimaryClip(
                                ClipData.newPlainText(
                                    context.getString(R.string.ai_tool_input),
                                    input
                                )
                            )
                        }
                    )
                }
                toolCall.output?.let { output ->
                    ToolCallDetailCard(
                        title = stringResource(id = R.string.ai_tool_output),
                        copyTitle = stringResource(id = R.string.ai_tool_copy_output),
                        value = output,
                        valueTag = aiToolCallOutputTag,
                        onCopy = {
                            clipboardManager.setPrimaryClip(
                                ClipData.newPlainText(
                                    context.getString(R.string.ai_tool_output),
                                    output
                                )
                            )
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolCallDetailCard(
    title: String,
    copyTitle: String,
    value: String,
    valueTag: String,
    onCopy: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(12.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.weight(1f))
                TextButton(onClick = onCopy) {
                    Icon(
                        imageVector = Icons.Outlined.ContentCopy,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(copyTitle)
                }
            }
            SelectionContainer {
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.testTag(tag = valueTag)
                )
            }
        }
    }
}
