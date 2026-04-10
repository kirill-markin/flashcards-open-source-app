package com.flashcardsopensourceapp.feature.ai

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus
import com.flashcardsopensourceapp.feature.settings.hasRequestedAccessPermission
import com.flashcardsopensourceapp.feature.settings.openApplicationSettings
import com.flashcardsopensourceapp.feature.settings.resolveAccessStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AiRouteContent(
    uiState: AiUiState,
    onAcceptConsent: () -> Unit,
    onDraftMessageChange: (String) -> Unit,
    onApplyComposerSuggestion: (AiChatComposerSuggestion) -> Unit,
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
    onScreenVisible: () -> Unit,
    onScreenHidden: () -> Unit,
    onWarmUpSessionIfNeeded: () -> Unit,
    onRetryConversationLoad: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit
) {
    val context = LocalContext.current
    val textProvider = remember(context) { aiTextProvider(context = context) }
    val focusManager = LocalFocusManager.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val activity = context as? ComponentActivity
    val dictationRecorder = remember(context) {
        AndroidAiChatDictationRecorder(
            context = context,
            textProvider = textProvider
        )
    }
    var isAttachmentSheetVisible by remember { mutableStateOf(value = false) }
    val currentConsentRequired by rememberUpdatedState(uiState.isConsentRequired)
    val currentDictationState by rememberUpdatedState(uiState.dictationState)
    val currentWarmUpAction by rememberUpdatedState(onWarmUpSessionIfNeeded)
    val currentCancelDictationAction by rememberUpdatedState(onCancelDictation)
    val currentScreenVisibleAction by rememberUpdatedState(onScreenVisible)
    val currentScreenHiddenAction by rememberUpdatedState(onScreenHidden)
    val currentShowAlertAction by rememberUpdatedState(onShowAlert)
    val dismissComposerFocus: () -> Unit = {
        focusManager.clearFocus(force = false)
    }

    val takePictureLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap: Bitmap? ->
        if (bitmap == null) {
            return@rememberLauncherForActivityResult
        }

        try {
            onAddPendingAttachment(
                makeAiChatAttachmentFromCameraBitmap(
                    bitmap = bitmap,
                    textProvider = textProvider
                )
            )
        } catch (error: Exception) {
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.CAMERA,
                    error = error,
                    textProvider = textProvider
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
                    uri = uri,
                    textProvider = textProvider
                )
            )
        } catch (error: Exception) {
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.PHOTOS,
                    error = error,
                    textProvider = textProvider
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
                    uri = uri,
                    textProvider = textProvider
                )
            )
        } catch (error: Exception) {
            currentShowAlertAction(
                aiAttachmentImportAlert(
                    capability = AccessCapability.FILES,
                    error = error,
                    textProvider = textProvider
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
                requestedStatus = if (isGranted) AccessStatus.ALLOWED else requestedStatus,
                textProvider = textProvider
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
                requestedStatus = if (isGranted) AccessStatus.ALLOWED else requestedStatus,
                textProvider = textProvider
            )
        ) {
            AiCapabilityPresentationResult.Present -> {
                startDictationRecording(
                    dictationRecorder = dictationRecorder,
                    textProvider = textProvider,
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

    LaunchedEffect(uiState.isConsentRequired) {
        if (uiState.isConsentRequired) {
            return@LaunchedEffect
        }

        onWarmUpSessionIfNeeded()
    }

    LaunchedEffect(Unit) {
        currentScreenVisibleAction()
    }

    DisposableEffect(lifecycleOwner, dictationRecorder) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    currentScreenVisibleAction()
                    if (currentConsentRequired.not()) {
                        currentWarmUpAction()
                    }
                }

                Lifecycle.Event.ON_STOP -> {
                    currentScreenHiddenAction()
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
            currentScreenHiddenAction()
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
                    Text(stringResource(id = R.string.ai_title))
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
                        enabled = uiState.canStartNewChat,
                        modifier = Modifier.testTag(tag = aiNewChatButtonTag)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.AddComment,
                            contentDescription = stringResource(id = R.string.ai_new_chat_content_description)
                        )
                    }
                }
            )
        },
        bottomBar = {
            if (uiState.isConsentRequired.not() && uiState.isConversationReady) {
                AiComposer(
                    uiState = uiState,
                    onDraftMessageChange = onDraftMessageChange,
                    onApplyComposerSuggestion = onApplyComposerSuggestion,
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
                            textProvider = textProvider,
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
        val contentModifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)

        if (uiState.isConsentRequired) {
            ConsentGate(
                currentWorkspaceName = uiState.currentWorkspaceName,
                onAcceptConsent = onAcceptConsent,
                modifier = contentModifier
            )
        } else if (uiState.isConversationLoading) {
            Box(
                modifier = contentModifier
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(24.dp)
                        .testTag(tag = aiConversationLoadingTag)
                ) {
                    CircularProgressIndicator()
                    Text(stringResource(id = R.string.ai_loading_chat_title))
                    Text(stringResource(id = R.string.ai_loading_chat_body))
                }
            }
        } else if (uiState.isConversationReady.not()) {
            Box(
                modifier = contentModifier
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(24.dp)
                ) {
                    Text(stringResource(id = R.string.ai_chat_unavailable_title))
                    Text(uiState.conversationErrorMessage)
                    if (uiState.canRetryConversationLoad) {
                        Button(onClick = onRetryConversationLoad) {
                            Text(stringResource(id = R.string.ai_retry))
                        }
                    }
                    if (uiState.showOpenAccountStatusForConversationError) {
                        Button(onClick = onOpenAccountStatus) {
                            Text(stringResource(id = R.string.ai_open_account_status))
                        }
                    }
                }
            }
        } else {
            AiConversation(
                messages = uiState.messages,
                currentWorkspaceName = uiState.currentWorkspaceName,
                isStreaming = uiState.isStreaming,
                onOpenAccountStatus = onOpenAccountStatus,
                onDismissComposerFocus = dismissComposerFocus,
                contentPadding = PaddingValues(
                    horizontal = 16.dp,
                    vertical = 16.dp
                ),
                modifier = contentModifier
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
                            textProvider = textProvider,
                            onShowAlert = onShowAlert,
                            onShowErrorMessage = onShowErrorMessage,
                            takePictureLauncher = takePictureLauncher,
                            cameraPermissionLauncher = cameraPermissionLauncher
                        )
                    }

                    AttachmentAction.CHOOSE_PHOTO -> {
                        handleAttachmentAction(
                            capability = AccessCapability.PHOTOS,
                            textProvider = textProvider,
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
                            textProvider = textProvider,
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
                        Text(stringResource(id = R.string.ai_open_settings))
                    }
                } else {
                    TextButton(onClick = onDismissAlert) {
                        Text(stringResource(id = R.string.ai_ok))
                    }
                }
            },
            dismissButton = if (activeAlert.showsSettingsAction) {
                {
                    TextButton(onClick = onDismissAlert) {
                        Text(stringResource(id = R.string.ai_cancel))
                    }
                }
            } else {
                null
            }
        )
    }
}
