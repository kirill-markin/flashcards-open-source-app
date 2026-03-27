package com.flashcardsopensourceapp.feature.ai

import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.ModelTraining
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.core.ui.components.NoticeCard
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus
import com.flashcardsopensourceapp.feature.settings.accessCapabilityPermission
import com.flashcardsopensourceapp.feature.settings.hasRequestedAccessPermission
import com.flashcardsopensourceapp.feature.settings.markAccessPermissionRequested
import com.flashcardsopensourceapp.feature.settings.openApplicationSettings
import com.flashcardsopensourceapp.feature.settings.openExternalUrl
import com.flashcardsopensourceapp.feature.settings.resolveAccessStatus
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import kotlinx.coroutines.delay

private enum class AttachmentAction {
    TAKE_PHOTO,
    CHOOSE_PHOTO,
    CHOOSE_FILE
}

private const val aiUserMessageBubbleTag = "ai_user_message_bubble"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiRoute(
    uiState: AiUiState,
    onAcceptConsent: () -> Unit,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit,
    onCancelStreaming: () -> Unit,
    onNewChat: () -> Unit,
    onOpenAccountStatus: () -> Unit,
    onDismissErrorMessage: () -> Unit,
    onDismissAlert: () -> Unit,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onWarmUpSessionIfNeeded: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val activity = context as? ComponentActivity
    val snackbarHostState = remember { SnackbarHostState() }
    val dictationRecorder = remember(context) {
        AndroidAiChatDictationRecorder(context = context)
    }
    var isAttachmentSheetVisible by remember { mutableStateOf(value = false) }
    val currentConsentRequired by rememberUpdatedState(uiState.isConsentRequired)
    val currentDictationState by rememberUpdatedState(uiState.dictationState)
    val currentWarmUpAction by rememberUpdatedState(onWarmUpSessionIfNeeded)
    val currentCancelDictationAction by rememberUpdatedState(onCancelDictation)
    val currentShowAlertAction by rememberUpdatedState(onShowAlert)
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
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.CAMERA,
                    error = error
                )
            )
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
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.PHOTOS,
                    error = error
                )
            )
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
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.FILES,
                    error = error
                )
            )
        }
    }
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (activity == null) {
            return@rememberLauncherForActivityResult
        }

        val requestedStatus = resolveAccessStatus(
            activity = activity,
            capability = AccessCapability.CAMERA,
            hasRequestedPermission = hasRequestedAccessPermission(
                context = activity,
                capability = AccessCapability.CAMERA
            )
        )
        when (
            val result = aiCapabilityPresentationResult(
                capability = AccessCapability.CAMERA,
                initialStatus = if (isGranted) AccessStatus.ALLOWED else AccessStatus.ASK_EVERY_TIME,
                requestedStatus = if (isGranted) AccessStatus.ALLOWED else requestedStatus
            )
        ) {
            AiCapabilityPresentationResult.Present -> takePictureLauncher.launch(null)
            AiCapabilityPresentationResult.StopSilently -> Unit
            is AiCapabilityPresentationResult.ShowAlert -> currentShowAlertAction(result.alert)
        }
    }
    val microphonePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (activity == null) {
            currentCancelDictationAction()
            return@rememberLauncherForActivityResult
        }

        val requestedStatus = resolveAccessStatus(
            activity = activity,
            capability = AccessCapability.MICROPHONE,
            hasRequestedPermission = hasRequestedAccessPermission(
                context = activity,
                capability = AccessCapability.MICROPHONE
            )
        )
        when (
            val result = aiCapabilityPresentationResult(
                capability = AccessCapability.MICROPHONE,
                initialStatus = if (isGranted) AccessStatus.ALLOWED else AccessStatus.ASK_EVERY_TIME,
                requestedStatus = if (isGranted) AccessStatus.ALLOWED else requestedStatus
            )
        ) {
            AiCapabilityPresentationResult.Present -> {
                startDictationRecording(
                    dictationRecorder = dictationRecorder,
                    onStartDictationRecording = onStartDictationRecording,
                    onShowAlert = currentShowAlertAction,
                    onCancelDictation = currentCancelDictationAction
                )
            }

            AiCapabilityPresentationResult.StopSilently -> {
                currentCancelDictationAction()
            }

            is AiCapabilityPresentationResult.ShowAlert -> {
                currentCancelDictationAction()
                currentShowAlertAction(result.alert)
            }
        }
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
                    onDraftMessageChange = onDraftMessageChange,
                    onSendMessage = onSendMessage,
                    onCancelStreaming = onCancelStreaming,
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
                            onShowAlert = onShowAlert,
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
                isStreaming = uiState.isStreaming,
                onOpenAccountStatus = onOpenAccountStatus,
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 16.dp
                )
            )
        }
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
                            onShowAlert = onShowAlert,
                            onShowErrorMessage = onShowErrorMessage,
                            takePictureLauncher = takePictureLauncher,
                            cameraPermissionLauncher = cameraPermissionLauncher
                        )
                    }

                    AttachmentAction.CHOOSE_PHOTO -> {
                        handleAttachmentAction(
                            capability = AccessCapability.PHOTOS,
                            onShowAlert = onShowAlert,
                            onPresent = {
                                choosePhotoLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            }
                        )
                    }

                    AttachmentAction.CHOOSE_FILE -> {
                        handleAttachmentAction(
                            capability = AccessCapability.FILES,
                            onShowAlert = onShowAlert,
                            onPresent = {
                                chooseDocumentLauncher.launch(aiChatDocumentPickerMimeTypes())
                            }
                        )
                    }
                }
            }
        )
    }

    uiState.activeAlert?.let { activeAlert ->
        AlertDialog(
            onDismissRequest = onDismissAlert,
            title = {
                Text(activeAlert.title)
            },
            text = {
                Text(activeAlert.message)
            },
            confirmButton = {
                if (activeAlert.showsSettingsAction) {
                    TextButton(
                        onClick = {
                            onDismissAlert()
                            openApplicationSettings(context = context)
                        }
                    ) {
                        Text("Open Settings")
                    }
                } else {
                    TextButton(onClick = onDismissAlert) {
                        Text("OK")
                    }
                }
            },
            dismissButton = if (activeAlert.showsSettingsAction) {
                {
                    TextButton(onClick = onDismissAlert) {
                        Text("Cancel")
                    }
                }
            } else {
                null
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
    val context = LocalContext.current
    val privacyUrl = stringResource(id = SettingsR.string.flashcards_privacy_policy_url)
    val termsUrl = stringResource(id = SettingsR.string.flashcards_terms_of_service_url)
    val supportUrl = stringResource(id = SettingsR.string.flashcards_support_url)

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
                    text = formatAiConsentWorkspaceDisclosureText(currentWorkspaceName = currentWorkspaceName),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Button(
                    onClick = onAcceptConsent,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("OK")
                }

                HorizontalDivider()

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = privacyUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Privacy Policy")
                }

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = termsUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Terms of Service")
                }

                TextButton(
                    onClick = {
                        openExternalUrl(context = context, url = supportUrl)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Support")
                }
            }
        }
    }
}

@Composable
private fun AiConversation(
    messages: List<AiChatMessage>,
    currentWorkspaceName: String,
    isStreaming: Boolean,
    onOpenAccountStatus: () -> Unit,
    contentPadding: PaddingValues
) {
    val listState = rememberLazyListState()
    val currentMessages by rememberUpdatedState(messages)
    val currentStreamingState by rememberUpdatedState(isStreaming)

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

    LaunchedEffect(autoScrollKey) {
        val layoutInfo = listState.layoutInfo
        val lastVisibleItemIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        val scrollState = aiConversationScrollState(
            totalItemsCount = layoutInfo.totalItemsCount,
            lastVisibleItemIndex = lastVisibleItemIndex,
            isUserScrolling = listState.isScrollInProgress,
            bottomThreshold = 1
        )
        if (scrollState.isNearBottom && scrollState.isUserScrolling.not()) {
            val lastItemIndex = conversationLastItemIndex(messages = messages)
            listState.animateScrollToItem(index = lastItemIndex)
        }
    }

    LaunchedEffect(isStreaming) {
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

    LazyColumn(
        state = listState,
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            NoticeCard(
                title = "Android AI",
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

@Composable
private fun MessageRow(
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
                modifier = Modifier.fillMaxWidth()
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
                            Text(text = contentPart.text)
                        }
                    }
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
private fun ToolCallCard(
    toolCall: AiChatToolCall
) {
    val context = LocalContext.current
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
        tonalElevation = 2.dp
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
                            input = toolCall.input
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                },
                supportingContent = {
                    Text(
                        text = formatAiToolCallStatus(status = toolCall.status),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                trailingContent = {
                    IconButton(
                        onClick = {
                            isExpanded = isExpanded.not()
                        }
                    ) {
                        Icon(
                            imageVector = if (isExpanded) {
                                Icons.Outlined.ExpandLess
                            } else {
                                Icons.Outlined.ExpandMore
                            },
                            contentDescription = if (isExpanded) {
                                "Collapse tool details"
                            } else {
                                "Expand tool details"
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
                        title = "Input",
                        value = input,
                        onCopy = {
                            clipboardManager.setPrimaryClip(
                                ClipData.newPlainText("Input", input)
                            )
                        }
                    )
                }
                toolCall.output?.let { output ->
                    ToolCallDetailCard(
                        title = "Output",
                        value = output,
                        onCopy = {
                            clipboardManager.setPrimaryClip(
                                ClipData.newPlainText("Output", output)
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
    value: String,
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
                    Text("Copy ${title.lowercase()}")
                }
            }
            SelectionContainer {
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace
                )
            }
        }
    }
}

@Composable
private fun RepairStatusCard(
    status: AiChatRepairAttemptStatus
) {
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

@Composable
private fun AiComposer(
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
    onShowAlert: (AiAlertState) -> Unit,
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
    when (
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.CAMERA,
            initialStatus = status,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
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
                return
            }

            takePictureLauncher.launch(null)
        }

        AiCapabilityPresentationResult.StopSilently -> Unit

        is AiCapabilityPresentationResult.ShowAlert -> {
            onShowAlert(result.alert)
        }
    }
}

private fun handleAttachmentAction(
    capability: AccessCapability,
    onShowAlert: (AiAlertState) -> Unit,
    onPresent: () -> Unit
) {
    when (
        val result = aiCapabilityPresentationResult(
            capability = capability,
            initialStatus = AccessStatus.SYSTEM_PICKER,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> onPresent()
        AiCapabilityPresentationResult.StopSilently -> Unit
        is AiCapabilityPresentationResult.ShowAlert -> onShowAlert(result.alert)
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
    onShowAlert: (AiAlertState) -> Unit,
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
            onShowAlert(AiAlertState.GeneralError(message = error.message ?: "Audio recording could not be finished."))
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
    when (
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.MICROPHONE,
            initialStatus = status,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
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
                return
            }

            startDictationRecording(
                dictationRecorder = dictationRecorder,
                onStartDictationRecording = onStartDictationRecording,
                onShowAlert = onShowAlert,
                onCancelDictation = onCancelDictation
            )
        }

        AiCapabilityPresentationResult.StopSilently -> {
            onCancelDictation()
        }

        is AiCapabilityPresentationResult.ShowAlert -> {
            onCancelDictation()
            onShowAlert(result.alert)
        }
    }
}

private fun startDictationRecording(
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationRecording: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onCancelDictation: () -> Unit
) {
    try {
        dictationRecorder.startRecording()
        onStartDictationRecording()
    } catch (error: Exception) {
        dictationRecorder.cancelRecording()
        onCancelDictation()
        onShowAlert(AiAlertState.GeneralError(message = error.message ?: "Audio recording could not be started."))
    }
}

private fun conversationLastItemIndex(
    messages: List<AiChatMessage>
): Int {
    return if (messages.isEmpty()) {
        1
    } else {
        messages.size
    }
}
