package com.flashcardsopensourceapp.feature.ai

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.ModelTraining
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatModelOption
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus
import com.flashcardsopensourceapp.feature.settings.accessCapabilityGuidance
import com.flashcardsopensourceapp.feature.settings.accessCapabilityPermission
import com.flashcardsopensourceapp.feature.settings.hasRequestedAccessPermission
import com.flashcardsopensourceapp.feature.settings.markAccessPermissionRequested
import com.flashcardsopensourceapp.feature.settings.openApplicationSettings
import com.flashcardsopensourceapp.feature.settings.resolveAccessStatus

private enum class AttachmentAction {
    TAKE_PHOTO,
    CHOOSE_PHOTO,
    CHOOSE_FILE
}

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
    onDismissErrorMessage: () -> Unit,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onWarmUpSessionIfNeeded: () -> Unit,
    onShowErrorMessage: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val activity = context as? ComponentActivity
    val snackbarHostState = remember { SnackbarHostState() }
    val dictationRecorder = remember(context) {
        AndroidAiChatDictationRecorder(context = context)
    }
    var isModelSheetVisible by remember { mutableStateOf(value = false) }
    var isAttachmentSheetVisible by remember { mutableStateOf(value = false) }
    val currentConsentRequired by rememberUpdatedState(uiState.isConsentRequired)
    val currentDictationState by rememberUpdatedState(uiState.dictationState)
    val currentWarmUpAction by rememberUpdatedState(onWarmUpSessionIfNeeded)
    val currentCancelDictationAction by rememberUpdatedState(onCancelDictation)
    val currentShowErrorAction by rememberUpdatedState(onShowErrorMessage)

    val takePictureLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap: Bitmap? ->
        if (bitmap == null) {
            return@rememberLauncherForActivityResult
        }

        try {
            onAddPendingAttachment(makeAiChatAttachmentFromCameraBitmap(bitmap = bitmap))
        } catch (error: Exception) {
            currentShowErrorAction(error.message ?: "Captured photo could not be added.")
        }
    }
    val choosePhotoLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        try {
            onAddPendingAttachment(
                makeAiChatImageAttachmentFromUri(
                    context = context,
                    uri = uri
                )
            )
        } catch (error: Exception) {
            currentShowErrorAction(error.message ?: "Selected image could not be added.")
        }
    }
    val chooseDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        try {
            onAddPendingAttachment(
                makeAiChatDocumentAttachmentFromUri(
                    context = context,
                    uri = uri
                )
            )
        } catch (error: Exception) {
            currentShowErrorAction(error.message ?: "Selected file could not be added.")
        }
    }
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (activity == null) {
            return@rememberLauncherForActivityResult
        }

        if (isGranted) {
            takePictureLauncher.launch(null)
            return@rememberLauncherForActivityResult
        }

        val status = resolveAccessStatus(
            activity = activity,
            capability = AccessCapability.CAMERA,
            hasRequestedPermission = hasRequestedAccessPermission(
                context = activity,
                capability = AccessCapability.CAMERA
            )
        )
        currentShowErrorAction(
            accessCapabilityGuidance(
                capability = AccessCapability.CAMERA,
                status = status
            )
        )
    }
    val microphonePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (activity == null) {
            currentCancelDictationAction()
            return@rememberLauncherForActivityResult
        }

        if (isGranted) {
            startDictationRecording(
                dictationRecorder = dictationRecorder,
                onStartDictationRecording = onStartDictationRecording,
                onShowErrorMessage = currentShowErrorAction,
                onCancelDictation = currentCancelDictationAction
            )
            return@rememberLauncherForActivityResult
        }

        currentCancelDictationAction()
        val status = resolveAccessStatus(
            activity = activity,
            capability = AccessCapability.MICROPHONE,
            hasRequestedPermission = hasRequestedAccessPermission(
                context = activity,
                capability = AccessCapability.MICROPHONE
            )
        )
        currentShowErrorAction(
            accessCapabilityGuidance(
                capability = AccessCapability.MICROPHONE,
                status = status
            )
        )
    }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
    }

    LaunchedEffect(uiState.isConsentRequired, uiState.isLinked) {
        if (uiState.isConsentRequired) {
            return@LaunchedEffect
        }

        if (uiState.isLinked.not()) {
            return@LaunchedEffect
        }

        onWarmUpSessionIfNeeded()
    }

    DisposableEffect(lifecycleOwner, dictationRecorder) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    if (currentConsentRequired.not()) {
                        currentWarmUpAction()
                    }
                }

                Lifecycle.Event.ON_STOP -> {
                    if (
                        currentDictationState == AiChatDictationState.RECORDING
                        || currentDictationState == AiChatDictationState.REQUESTING_PERMISSION
                    ) {
                        dictationRecorder.cancelRecording()
                        currentCancelDictationAction()
                    }
                }

                else -> Unit
            }
        }

        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            if (
                currentDictationState == AiChatDictationState.RECORDING
                || currentDictationState == AiChatDictationState.REQUESTING_PERMISSION
            ) {
                dictationRecorder.cancelRecording()
                currentCancelDictationAction()
            }
        }
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
                    uiState = uiState,
                    selectedModelLabel = modelLabel(
                        modelId = uiState.selectedModelId,
                        options = uiState.availableModels
                    ),
                    onDraftMessageChange = onDraftMessageChange,
                    onSendMessage = onSendMessage,
                    onRemovePendingAttachment = onRemovePendingAttachment,
                    onOpenAttachmentMenu = {
                        isAttachmentSheetVisible = true
                    },
                    onToggleDictation = {
                        handleDictationToggle(
                            activity = activity,
                            dictationState = uiState.dictationState,
                            dictationRecorder = dictationRecorder,
                            onStartDictationPermissionRequest = onStartDictationPermissionRequest,
                            onStartDictationRecording = onStartDictationRecording,
                            onTranscribeRecordedAudio = onTranscribeRecordedAudio,
                            onCancelDictation = onCancelDictation,
                            onShowErrorMessage = onShowErrorMessage,
                            microphonePermissionLauncher = microphonePermissionLauncher
                        )
                    }
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

    if (isAttachmentSheetVisible) {
        AttachmentSheet(
            onDismiss = {
                isAttachmentSheetVisible = false
            },
            onSelectAction = { action ->
                isAttachmentSheetVisible = false
                when (action) {
                    AttachmentAction.TAKE_PHOTO -> {
                        handleCameraAction(
                            activity = activity,
                            onShowErrorMessage = onShowErrorMessage,
                            takePictureLauncher = takePictureLauncher,
                            cameraPermissionLauncher = cameraPermissionLauncher
                        )
                    }

                    AttachmentAction.CHOOSE_PHOTO -> {
                        choosePhotoLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    }

                    AttachmentAction.CHOOSE_FILE -> {
                        chooseDocumentLauncher.launch(aiChatDocumentPickerMimeTypes())
                    }
                }
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
                    text = "AI requests from $currentWorkspaceName can send prompts, uploaded files, images, and dictated audio to external providers.",
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
        item {
            DraftNoticeCard(
                title = "Android draft AI shell",
                body = "Android AI now supports native attachments, dictation, linked-session warm-up, and multimodal chat input while keeping the UI fully Material.",
                modifier = Modifier
            )
        }

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
    val alignment = if (message.role == AiChatRole.USER) {
        Alignment.CenterEnd
    } else {
        Alignment.CenterStart
    }
    val containerColor = if (message.role == AiChatRole.USER) {
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
            modifier = Modifier.fillMaxWidth(if (message.role == AiChatRole.USER) 0.88f else 1f)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .background(containerColor)
                    .padding(16.dp)
            ) {
                Text(
                    text = if (message.role == AiChatRole.USER) "You" else "AI",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )

                message.content.forEach { contentPart ->
                    when (contentPart) {
                        is AiChatContentPart.Text -> {
                            Text(text = contentPart.text)
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
private fun AttachmentContentCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector
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
private fun ToolCallCard(
    toolCall: AiChatToolCall
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
                text = if (toolCall.status == AiChatToolCallStatus.STARTED) "Running" else "Completed",
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
    uiState: AiUiState,
    selectedModelLabel: String,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit,
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
                    text = if (uiState.isLinked) "Linked account" else "Guest AI",
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
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "${status.message} ${status.attempt}/${status.maxAttempts}",
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
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
                    enabled = canManageAttachments,
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
                    enabled = uiState.isStreaming.not() && isDictationBusy.not(),
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
                onClick = onSendMessage,
                enabled = uiState.canSend,
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
private fun AttachmentSheet(
    onDismiss: () -> Unit,
    onSelectAction: (AttachmentAction) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item {
                ListItem(
                    headlineContent = {
                        Text("Take photo")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.CameraAlt, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Capture a photo directly from Android.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.TAKE_PHOTO)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open camera")
                }
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                ListItem(
                    headlineContent = {
                        Text("Choose photo")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.PhotoLibrary, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Use the Android system photo picker.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.CHOOSE_PHOTO)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open photo picker")
                }
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                ListItem(
                    headlineContent = {
                        Text("Choose file")
                    },
                    leadingContent = {
                        Icon(Icons.Outlined.AttachFile, contentDescription = null)
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                    supportingContent = {
                        Text("Use the Android system document picker.")
                    }
                )
                TextButton(
                    onClick = {
                        onSelectAction(AttachmentAction.CHOOSE_FILE)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                ) {
                    Text("Open file picker")
                }
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
                        text = if (model.id == selectedModelId) "Keep selected" else "Use ${model.label}"
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

private fun dictationStatusLabel(
    dictationState: AiChatDictationState
): String {
    return when (dictationState) {
        AiChatDictationState.IDLE -> ""
        AiChatDictationState.REQUESTING_PERMISSION -> "Requesting microphone access..."
        AiChatDictationState.RECORDING -> "Recording audio..."
        AiChatDictationState.TRANSCRIBING -> "Transcribing audio..."
    }
}

private fun handleCameraAction(
    activity: ComponentActivity?,
    onShowErrorMessage: (String) -> Unit,
    takePictureLauncher: androidx.activity.result.ActivityResultLauncher<Void?>,
    cameraPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>
) {
    if (activity == null) {
        onShowErrorMessage("Camera is unavailable in this Android host.")
        return
    }

    val status = resolveAccessStatus(
        activity = activity,
        capability = AccessCapability.CAMERA,
        hasRequestedPermission = hasRequestedAccessPermission(
            context = activity,
            capability = AccessCapability.CAMERA
        )
    )
    when (status) {
        AccessStatus.ALLOWED -> {
            takePictureLauncher.launch(null)
        }

        AccessStatus.ASK_EVERY_TIME -> {
            val permission = requireNotNull(
                accessCapabilityPermission(capability = AccessCapability.CAMERA)
            ) {
                "Camera permission is unavailable."
            }
            markAccessPermissionRequested(
                context = activity,
                capability = AccessCapability.CAMERA
            )
            cameraPermissionLauncher.launch(permission)
        }

        AccessStatus.BLOCKED -> {
            openApplicationSettings(context = activity)
        }

        AccessStatus.UNAVAILABLE -> {
            onShowErrorMessage(
                accessCapabilityGuidance(
                    capability = AccessCapability.CAMERA,
                    status = status
                )
            )
        }

        AccessStatus.SYSTEM_PICKER -> Unit
    }
}

private fun handleDictationToggle(
    activity: ComponentActivity?,
    dictationState: AiChatDictationState,
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onShowErrorMessage: (String) -> Unit,
    microphonePermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>
) {
    if (dictationState == AiChatDictationState.RECORDING) {
        try {
            val recordedAudio = dictationRecorder.stopRecording()
            onTranscribeRecordedAudio(
                recordedAudio.fileName,
                recordedAudio.mediaType,
                recordedAudio.audioBytes
            )
        } catch (error: Exception) {
            dictationRecorder.cancelRecording()
            onCancelDictation()
            onShowErrorMessage(error.message ?: "Audio recording could not be finished.")
        }
        return
    }

    if (activity == null) {
        onShowErrorMessage("Microphone is unavailable in this Android host.")
        onCancelDictation()
        return
    }

    val status = resolveAccessStatus(
        activity = activity,
        capability = AccessCapability.MICROPHONE,
        hasRequestedPermission = hasRequestedAccessPermission(
            context = activity,
            capability = AccessCapability.MICROPHONE
        )
    )
    when (status) {
        AccessStatus.ALLOWED -> {
            startDictationRecording(
                dictationRecorder = dictationRecorder,
                onStartDictationRecording = onStartDictationRecording,
                onShowErrorMessage = onShowErrorMessage,
                onCancelDictation = onCancelDictation
            )
        }

        AccessStatus.ASK_EVERY_TIME -> {
            val permission = requireNotNull(
                accessCapabilityPermission(capability = AccessCapability.MICROPHONE)
            ) {
                "Microphone permission is unavailable."
            }
            onStartDictationPermissionRequest()
            markAccessPermissionRequested(
                context = activity,
                capability = AccessCapability.MICROPHONE
            )
            microphonePermissionLauncher.launch(permission)
        }

        AccessStatus.BLOCKED -> {
            openApplicationSettings(context = activity)
            onCancelDictation()
        }

        AccessStatus.UNAVAILABLE -> {
            onShowErrorMessage(
                accessCapabilityGuidance(
                    capability = AccessCapability.MICROPHONE,
                    status = status
                )
            )
            onCancelDictation()
        }

        AccessStatus.SYSTEM_PICKER -> Unit
    }
}

private fun startDictationRecording(
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationRecording: () -> Unit,
    onShowErrorMessage: (String) -> Unit,
    onCancelDictation: () -> Unit
) {
    try {
        dictationRecorder.startRecording()
        onStartDictationRecording()
    } catch (error: Exception) {
        dictationRecorder.cancelRecording()
        onCancelDictation()
        onShowErrorMessage(error.message ?: "Audio recording could not be started.")
    }
}
