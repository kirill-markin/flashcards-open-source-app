package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState

@Composable
internal fun AiComposer(
    uiState: AiUiState,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit,
    onCancelStreaming: () -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onOpenAttachmentMenu: () -> Unit,
    onToggleDictation: () -> Unit
) {
    val canEditDraft = uiState.isStreaming.not() && uiState.dictationState == AiChatDictationState.IDLE
    val canManageAttachments = uiState.isStreaming.not() && uiState.dictationState == AiChatDictationState.IDLE
    val isDictationBusy = uiState.dictationState == AiChatDictationState.REQUESTING_PERMISSION
        || uiState.dictationState == AiChatDictationState.TRANSCRIBING

    Surface(
        tonalElevation = 4.dp
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = {
                        Text(uiState.chatConfig.model.badgeLabel)
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Outlined.AutoAwesome,
                            contentDescription = null
                        )
                    }
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = uiState.chatConfig.provider.label,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.weight(1f))
                if (uiState.isStreaming) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.width(20.dp)
                    )
                }
            }

            if (uiState.pendingAttachments.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    uiState.pendingAttachments.forEach { attachment ->
                        FilterChip(
                            selected = true,
                            onClick = {},
                            label = {
                                Text(attachment.fileName)
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = if (attachment.isImage) {
                                        Icons.Outlined.Image
                                    } else {
                                        Icons.Outlined.Description
                                    },
                                    contentDescription = null
                                )
                            },
                            trailingIcon = {
                                IconButton(
                                    onClick = {
                                        onRemovePendingAttachment(attachment.id)
                                    },
                                    enabled = canManageAttachments
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Close,
                                        contentDescription = "Remove attachment"
                                    )
                                }
                            }
                        )
                    }
                }
            }

            uiState.repairStatus?.let { status ->
                RepairStatusCard(status = status)
            }

            if (uiState.dictationState != AiChatDictationState.IDLE) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = dictationStatusLabel(dictationState = uiState.dictationState),
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            OutlinedTextField(
                value = uiState.draftMessage,
                onValueChange = onDraftMessageChange,
                label = {
                    Text("Message")
                },
                minLines = 3,
                enabled = canEditDraft,
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Button(
                    onClick = onOpenAttachmentMenu,
                    enabled = canManageAttachments && uiState.chatConfig.features.attachmentsEnabled,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.AttachFile,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Attach")
                }

                Button(
                    onClick = onToggleDictation,
                    enabled = uiState.isStreaming.not() && isDictationBusy.not() && uiState.chatConfig.features.dictationEnabled,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = if (uiState.dictationState == AiChatDictationState.RECORDING) {
                            Icons.Outlined.Stop
                        } else {
                            Icons.Outlined.Mic
                        },
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        if (uiState.dictationState == AiChatDictationState.RECORDING) {
                            "Stop"
                        } else {
                            "Dictate"
                        }
                    )
                }
            }

            Button(
                onClick = if (uiState.canStopStreaming) {
                    onCancelStreaming
                } else {
                    onSendMessage
                },
                enabled = uiState.canStopStreaming || uiState.canSend,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = if (uiState.canStopStreaming) {
                        Icons.Outlined.Stop
                    } else {
                        Icons.AutoMirrored.Outlined.Send
                    },
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(if (uiState.canStopStreaming) "Stop" else "Send")
            }
        }
    }
}
