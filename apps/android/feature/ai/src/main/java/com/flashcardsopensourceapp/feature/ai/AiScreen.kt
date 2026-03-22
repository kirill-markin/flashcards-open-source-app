package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.ModelTraining
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatModelOption
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiRoute(
    uiState: AiUiState,
    onAcceptConsent: () -> Unit,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit,
    onSelectModel: (String) -> Unit,
    onNewChat: () -> Unit,
    onOpenSignIn: () -> Unit,
    onDismissErrorMessage: () -> Unit
) {
    val snackbarHostState = remember { SnackbarHostState() }
    var isModelSheetVisible by remember { mutableStateOf(value = false) }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("AI")
                },
                actions = {
                    AssistChip(
                        onClick = {
                            if (uiState.isModelPickerEnabled) {
                                isModelSheetVisible = true
                            }
                        },
                        enabled = uiState.isModelPickerEnabled,
                        label = {
                            Text(modelLabel(modelId = uiState.selectedModelId, options = uiState.availableModels))
                        },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Outlined.ModelTraining,
                                contentDescription = null
                            )
                        }
                    )

                    IconButton(
                        onClick = onNewChat,
                        enabled = uiState.canStartNewChat
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.AddComment,
                            contentDescription = "New chat"
                        )
                    }
                }
            )
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        },
        bottomBar = {
            if (uiState.isConsentRequired.not()) {
                AiComposer(
                    draftMessage = uiState.draftMessage,
                    selectedModelLabel = modelLabel(
                        modelId = uiState.selectedModelId,
                        options = uiState.availableModels
                    ),
                    isLinked = uiState.isLinked,
                    isStreaming = uiState.isStreaming,
                    canSend = uiState.canSend,
                    repairStatus = uiState.repairStatus,
                    onDraftMessageChange = onDraftMessageChange,
                    onSendMessage = onSendMessage
                )
            }
        }
    ) { innerPadding ->
        if (uiState.isConsentRequired) {
            ConsentGate(
                currentWorkspaceName = uiState.currentWorkspaceName,
                onAcceptConsent = onAcceptConsent,
                modifier = Modifier.padding(innerPadding)
            )
        } else {
            AiConversation(
                messages = uiState.messages,
                currentWorkspaceName = uiState.currentWorkspaceName,
                onOpenSignIn = onOpenSignIn,
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 16.dp
                )
            )
        }
    }

    if (isModelSheetVisible) {
        ModelPickerSheet(
            selectedModelId = uiState.selectedModelId,
            availableModels = uiState.availableModels,
            onDismiss = {
                isModelSheetVisible = false
            },
            onSelectModel = { modelId ->
                onSelectModel(modelId)
                isModelSheetVisible = false
            }
        )
    }
}

@Composable
private fun ConsentGate(
    currentWorkspaceName: String,
    onAcceptConsent: () -> Unit,
    modifier: Modifier
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.fillMaxSize()
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(24.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "Before you use AI",
                    style = MaterialTheme.typography.headlineSmall
                )
                Text(
                    text = "AI can be wrong. Review important results before relying on them.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "AI requests from $currentWorkspaceName can send prompts and card-derived context to external providers.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Button(
                    onClick = onAcceptConsent,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("OK")
                }
            }
        }
    }
}

@Composable
private fun AiConversation(
    messages: List<AiChatMessage>,
    currentWorkspaceName: String,
    onOpenSignIn: () -> Unit,
    contentPadding: PaddingValues
) {
    LazyColumn(
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        if (messages.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Try asking",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Summarize weak areas from my due cards in $currentWorkspaceName."
                        )
                        Text(text = "Find cards tagged with grammar and suggest cleanup.")
                        Text(text = "Propose a new deck filter and explain the exact change.")
                    }
                }
            }
        }

        items(messages, key = { message -> message.messageId }) { message ->
            MessageRow(
                message = message,
                onOpenSignIn = onOpenSignIn
            )
        }
    }
}

@Composable
private fun MessageRow(
    message: AiChatMessage,
    onOpenSignIn: () -> Unit
) {
    val alignment = if (message.role == com.flashcardsopensourceapp.data.local.model.AiChatRole.USER) {
        Alignment.CenterEnd
    } else {
        Alignment.CenterStart
    }
    val containerColor = if (message.role == com.flashcardsopensourceapp.data.local.model.AiChatRole.USER) {
        MaterialTheme.colorScheme.primaryContainer
    } else if (message.isError) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }

    Box(
        contentAlignment = alignment,
        modifier = Modifier.fillMaxWidth()
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(if (message.role == com.flashcardsopensourceapp.data.local.model.AiChatRole.USER) 0.88f else 1f)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .background(containerColor)
                    .padding(16.dp)
            ) {
                Text(
                    text = if (message.role == com.flashcardsopensourceapp.data.local.model.AiChatRole.USER) {
                        "You"
                    } else {
                        "AI"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )

                message.content.forEach { contentPart ->
                    when (contentPart) {
                        is AiChatContentPart.Text -> {
                            Text(text = contentPart.text)
                        }

                        is AiChatContentPart.ToolCall -> {
                            ToolCallCard(toolCall = contentPart.toolCall)
                        }

                        is AiChatContentPart.AccountUpgradePrompt -> {
                            AccountUpgradeCard(
                                message = contentPart.message,
                                buttonTitle = contentPart.buttonTitle,
                                onOpenSignIn = onOpenSignIn
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolCallCard(
    toolCall: com.flashcardsopensourceapp.data.local.model.AiChatToolCall
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(14.dp)
        ) {
            Text(
                text = "Tool: ${toolCall.name}",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = if (toolCall.status == com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus.STARTED) {
                    "Running"
                } else {
                    "Completed"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            toolCall.input?.let { input ->
                Text(
                    text = "Input\n$input",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            toolCall.output?.let { output ->
                Text(
                    text = "Output\n$output",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun AccountUpgradeCard(
    message: String,
    buttonTitle: String,
    onOpenSignIn: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(text = message)
            Button(
                onClick = onOpenSignIn,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(buttonTitle)
            }
        }
    }
}

@Composable
private fun AiComposer(
    draftMessage: String,
    selectedModelLabel: String,
    isLinked: Boolean,
    isStreaming: Boolean,
    canSend: Boolean,
    repairStatus: AiChatRepairAttemptStatus?,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit
) {
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
                        Text(selectedModelLabel)
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
                    text = if (isLinked) "Linked account" else "Guest AI",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.weight(1f))
                if (isStreaming) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.width(20.dp)
                    )
                }
            }

            repairStatus?.let { status ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "${status.message} ${status.attempt}/${status.maxAttempts}",
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            OutlinedTextField(
                value = draftMessage,
                onValueChange = onDraftMessageChange,
                label = {
                    Text("Message")
                },
                minLines = 3,
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = onSendMessage,
                enabled = canSend,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Outlined.Send,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelPickerSheet(
    selectedModelId: String,
    availableModels: List<AiChatModelOption>,
    onDismiss: () -> Unit,
    onSelectModel: (String) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item {
                Text(
                    text = "Models",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(start = 24.dp, top = 8.dp, end = 24.dp, bottom = 16.dp)
                )
            }

            items(availableModels, key = { model -> model.id }) { model ->
                ListItem(
                    headlineContent = {
                        Text(model.label)
                    },
                    supportingContent = {
                        if (model.id == selectedModelId) {
                            Text("Selected")
                        }
                    },
                    modifier = Modifier.padding(horizontal = 8.dp)
                )
                TextButton(
                    onClick = {
                        onSelectModel(model.id)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text(
                        text = if (model.id == selectedModelId) "Keep selected" else "Use ${model.label}",
                        textAlign = TextAlign.Start,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

private fun modelLabel(
    modelId: String,
    options: List<AiChatModelOption>
): String {
    return options.firstOrNull { option ->
        option.id == modelId
    }?.label ?: modelId
}
