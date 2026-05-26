package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.core.observability.AndroidAiObservationName
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import java.io.IOException

internal data class AiChatContentPartCounts(
    val textPartCount: Int,
    val imagePartCount: Int,
    val filePartCount: Int,
    val cardPartCount: Int
)

internal data class AiChatRemoteErrorDetails(
    val requestId: String?,
    val statusCode: Int?,
    val code: String?,
    val stage: String?
)

internal enum class AiChatFailureIssueDisposition {
    NONE,
    WARNING,
    EXCEPTION
}

private data class AiChatObservationVersions(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

internal sealed interface AiChatBreadcrumb {
    data class SwitchAccessContextCancellingWarmUp(
        val nextWorkspaceId: String?,
        val currentWorkspaceId: String?,
        val cloudState: String
    ) : AiChatBreadcrumb

    data class WarmUpCancelled(
        val workspaceId: String?,
        val currentWorkspaceId: String?,
        val cloudState: String,
        val retryAfterWorkspaceSwitch: Boolean,
        val message: String?
    ) : AiChatBreadcrumb

    data class NewChatCancelled(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val message: String?
    ) : AiChatBreadcrumb

    data class ConversationBootstrapCancelled(
        val workspaceId: String?,
        val cloudState: String
    ) : AiChatBreadcrumb

    data class UiSendMessageRequested(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val messageCount: Int,
        val pendingAttachmentCount: Int,
        val contentCounts: AiChatContentPartCounts
    ) : AiChatBreadcrumb

    data class RuntimeHandoffRequested(
        val workspaceId: String?,
        val cardId: String,
        val conversationBootstrapState: String,
        val dictationState: String,
        val composerPhase: String,
        val chatSessionIdBlank: Boolean,
        val pendingAttachmentCount: Int,
        val draftLength: Int,
        val messageCount: Int
    ) : AiChatBreadcrumb

    data class RuntimeHandoffAppliedToRunningDraft(
        val workspaceId: String?,
        val cardId: String,
        val chatSessionId: String,
        val pendingAttachmentCount: Int
    ) : AiChatBreadcrumb

    data class RuntimeHandoffStartFreshConversation(
        val workspaceId: String?,
        val cardId: String
    ) : AiChatBreadcrumb

    data class RuntimeHandoffAppliedToExistingSession(
        val workspaceId: String?,
        val cardId: String,
        val chatSessionId: String,
        val pendingAttachmentCount: Int
    ) : AiChatBreadcrumb
}

internal sealed interface AiChatWarning {
    data class PostRunSyncFailed(
        val workspaceId: String?,
        val reason: String,
        val error: Throwable
    ) : AiChatWarning

    data class PostRunSyncFlagPersistFailed(
        val workspaceId: String?,
        val reason: String,
        val error: Throwable
    ) : AiChatWarning

    data class WarmUpFailureHandled(
        val workspaceId: String?,
        val cloudState: String,
        val remoteError: AiChatRemoteErrorDetails?,
        val message: String?
    ) : AiChatWarning

    data class SendFailureHandled(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val messageCount: Int,
        val remoteError: AiChatRemoteErrorDetails?,
        val message: String?
    ) : AiChatWarning

    data class NewChatFailureHandled(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val messageCount: Int,
        val remoteError: AiChatRemoteErrorDetails?,
        val message: String?
    ) : AiChatWarning

    data class ConversationBootstrapFailed(
        val workspaceId: String?,
        val cloudState: String,
        val remoteError: AiChatRemoteErrorDetails?,
        val message: String?
    ) : AiChatWarning

    data class RuntimeHandoffRejectedNotReady(
        val workspaceId: String?,
        val cardId: String,
        val conversationBootstrapState: String,
        val dictationState: String
    ) : AiChatWarning

    data class RuntimeHandoffRejectedLockedPhase(
        val workspaceId: String?,
        val cardId: String,
        val composerPhase: String
    ) : AiChatWarning

    data class RuntimeHandoffRejectedAccessPreparing(
        val workspaceId: String?,
        val cardId: String,
        val cloudState: String,
        val conversationBootstrapState: String
    ) : AiChatWarning
}

internal sealed interface AiChatExceptionEvent {
    val error: Throwable

    data class WarmUpFailed(
        val workspaceId: String?,
        val cloudState: String,
        val message: String?,
        val remoteError: AiChatRemoteErrorDetails?,
        override val error: Throwable
    ) : AiChatExceptionEvent

    data class SendFailureHandled(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val messageCount: Int,
        val userFacingMessage: String,
        val remoteError: AiChatRemoteErrorDetails?,
        override val error: Throwable
    ) : AiChatExceptionEvent

    data class NewChatFailureHandled(
        val workspaceId: String?,
        val cloudState: String,
        val chatSessionId: String,
        val messageCount: Int,
        val userFacingMessage: String,
        val remoteError: AiChatRemoteErrorDetails?,
        override val error: Throwable
    ) : AiChatExceptionEvent

    data class ConversationBootstrapFailed(
        val workspaceId: String?,
        val cloudState: String,
        val remoteError: AiChatRemoteErrorDetails?,
        override val error: Throwable
    ) : AiChatExceptionEvent
}

internal fun AppObservability.recordAiChatBreadcrumb(breadcrumb: AiChatBreadcrumb) {
    addBreadcrumb(event = breadcrumb.toAndroidEvent())
}

internal fun AppObservability.recordAiChatWarning(warning: AiChatWarning) {
    captureWarning(event = warning.toAndroidEvent())
}

internal fun AppObservability.recordAiChatException(exception: AiChatExceptionEvent) {
    captureException(event = exception.toAndroidEvent())
}

internal fun createAiChatRuntimeObservability(
    observability: AppObservability,
    appVersion: String,
    versionCode: Int
): AppObservability {
    val versions = createAiChatObservationVersions(
        appVersion = appVersion,
        versionCode = versionCode
    )
    return AiChatRuntimeAppObservability(
        delegate = observability,
        versions = versions
    )
}

internal fun countAiChatContentParts(content: List<AiChatContentPart>): AiChatContentPartCounts {
    return AiChatContentPartCounts(
        textPartCount = content.count { part -> part is AiChatContentPart.Text },
        imagePartCount = content.count { part -> part is AiChatContentPart.Image },
        filePartCount = content.count { part -> part is AiChatContentPart.File },
        cardPartCount = content.count { part -> part is AiChatContentPart.Card }
    )
}

internal fun aiChatRemoteErrorDetails(error: AiChatRemoteException?): AiChatRemoteErrorDetails? {
    if (error == null) {
        return null
    }

    return AiChatRemoteErrorDetails(
        requestId = error.requestId,
        statusCode = error.statusCode,
        code = error.code,
        stage = error.stage
    )
}

internal fun aiChatFailureIssueDisposition(error: Exception): AiChatFailureIssueDisposition {
    if (error is AiChatRemoteException) {
        return if (isExpectedAiChatRemoteError(error = error)) {
            AiChatFailureIssueDisposition.NONE
        } else {
            AiChatFailureIssueDisposition.WARNING
        }
    }
    if (error is IOException) {
        return AiChatFailureIssueDisposition.WARNING
    }
    if (error is AiChatBootstrapBlockedException) {
        return AiChatFailureIssueDisposition.WARNING
    }

    return AiChatFailureIssueDisposition.EXCEPTION
}

internal fun aiChatFailureWarningMessage(error: Exception): String? {
    if (error is AiChatRemoteException && error.responseBody != null) {
        return null
    }

    return aiWarningFailureMessage(reason = "handled_failure", error = error)
}

private fun aiWarningFailureMessage(
    reason: String,
    error: Throwable
): String {
    val topFrame = error.stackTrace.firstOrNull()
    val topFrameText = if (topFrame == null) {
        "unknown"
    } else {
        "${topFrame.className}.${topFrame.methodName}:${topFrame.lineNumber}"
    }
    return "reason=$reason errorType=${error::class.java.name} " +
        "errorMessage=${redactedAiWarningErrorMessage(value = error.message)} topFrame=$topFrameText"
}

private fun redactedAiWarningErrorMessage(value: String?): String {
    return if (value.isNullOrBlank()) {
        "null"
    } else {
        "[redacted]"
    }
}

private fun isExpectedAiChatRemoteError(error: AiChatRemoteException): Boolean {
    val statusCode = error.statusCode
    if (statusCode == 401 || statusCode == 403 || statusCode == 429) {
        return true
    }

    val code = error.code?.trim()?.uppercase() ?: return false
    return expectedAiChatRemoteErrorCodes.contains(element = code)
}

private val expectedAiChatRemoteErrorCodes: Set<String> = setOf(
    "AI_WORKSPACE_REQUIRED",
    "AUTH_UNAUTHORIZED",
    "CHAT_ACTIVE_RUN_IN_PROGRESS",
    "CHAT_LIVE_AFTER_CURSOR_INVALID",
    "CHAT_LIVE_AUTH_EXPIRED",
    "CHAT_LIVE_AUTH_INVALID",
    "CHAT_LIVE_NOT_FOUND",
    "CHAT_LIVE_RUN_ID_REQUIRED",
    "CHAT_LIVE_SESSION_ID_REQUIRED",
    "CHAT_SESSION_ID_CONFLICT",
    "CHAT_TRANSCRIPTION_FILE_EMPTY",
    "CHAT_TRANSCRIPTION_FILE_REQUIRED",
    "CHAT_TRANSCRIPTION_FILE_UNSUPPORTED",
    "CHAT_TRANSCRIPTION_INVALID_AUDIO",
    "CHAT_TRANSCRIPTION_INVALID_MULTIPART",
    "CHAT_TRANSCRIPTION_RATE_LIMITED",
    "CHAT_TRANSCRIPTION_SOURCE_INVALID",
    "GUEST_AI_LIMIT_REACHED",
    "GUEST_AUTH_INVALID",
    "WORKSPACE_ID_INVALID",
    "WORKSPACE_ID_REQUIRED",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_SELECTION_REQUIRED"
)

private class AiChatRuntimeAppObservability(
    private val delegate: AppObservability,
    private val versions: AiChatObservationVersions
) : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) {
        delegate.setCloudIdentity(identity = identity)
    }

    override fun clearCloudIdentity() {
        delegate.clearCloudIdentity()
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
        delegate.addBreadcrumb(event = event.withAiChatObservationVersions(versions = versions))
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        delegate.captureWarning(event = event.withAiChatObservationVersions(versions = versions))
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
        delegate.captureException(event = event.withAiChatObservationVersions(versions = versions))
    }
}

private fun createAiChatObservationVersions(
    appVersion: String,
    versionCode: Int
): AiChatObservationVersions {
    val resolvedAppVersion = appVersion.ifBlank { null }
    return AiChatObservationVersions(
        appVersion = resolvedAppVersion,
        clientVersion = resolvedAppVersion,
        versionCode = versionCode
    )
}

private fun AndroidBreadcrumbEvent.withAiChatObservationVersions(
    versions: AiChatObservationVersions
): AndroidBreadcrumbEvent {
    return when (this) {
        is AndroidBreadcrumbEvent.AiRuntimeBreadcrumb -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        else -> this
    }
}

private fun AndroidWarningIssueEvent.withAiChatObservationVersions(
    versions: AiChatObservationVersions
): AndroidWarningIssueEvent {
    return when (this) {
        is AndroidWarningIssueEvent.AiRemoteError -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidWarningIssueEvent.AiLifecycleWarning -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidWarningIssueEvent.AiSendWarning -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidWarningIssueEvent.AiBootstrapWarning -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidWarningIssueEvent.AiRuntimeWarning -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        else -> this
    }
}

private fun AndroidExceptionIssueEvent.withAiChatObservationVersions(
    versions: AiChatObservationVersions
): AndroidExceptionIssueEvent {
    return when (this) {
        is AndroidExceptionIssueEvent.AiStreamCrash -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidExceptionIssueEvent.AiLifecycleError -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidExceptionIssueEvent.AiSendError -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidExceptionIssueEvent.AiBootstrapError -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        is AndroidExceptionIssueEvent.AiRuntimeException -> copy(
            appVersion = appVersion ?: versions.appVersion,
            clientVersion = clientVersion ?: versions.clientVersion,
            versionCode = versionCode ?: versions.versionCode
        )
        else -> this
    }
}

private fun AiChatBreadcrumb.toAndroidEvent(): AndroidBreadcrumbEvent.AiRuntimeBreadcrumb {
    return when (this) {
        is AiChatBreadcrumb.SwitchAccessContextCancellingWarmUp -> aiBreadcrumb(
            name = AndroidAiObservationName.SWITCH_ACCESS_CONTEXT_CANCELLING_WARM_UP,
            workspaceId = currentWorkspaceId,
            cloudState = cloudState,
            message = nextWorkspaceId
        )
        is AiChatBreadcrumb.WarmUpCancelled -> aiBreadcrumb(
            name = AndroidAiObservationName.WARM_UP_CANCELLED,
            workspaceId = workspaceId,
            cloudState = cloudState,
            message = message,
            pendingAttachmentCount = if (retryAfterWorkspaceSwitch) 1 else 0
        )
        is AiChatBreadcrumb.NewChatCancelled -> aiBreadcrumb(
            name = AndroidAiObservationName.NEW_CHAT_CANCELLED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cloudState = cloudState,
            message = message
        )
        is AiChatBreadcrumb.ConversationBootstrapCancelled -> aiBreadcrumb(
            name = AndroidAiObservationName.CONVERSATION_BOOTSTRAP_CANCELLED,
            workspaceId = workspaceId,
            cloudState = cloudState
        )
        is AiChatBreadcrumb.UiSendMessageRequested -> aiBreadcrumb(
            name = AndroidAiObservationName.UI_SEND_MESSAGE_REQUESTED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cloudState = cloudState,
            messageCount = messageCount,
            pendingAttachmentCount = pendingAttachmentCount,
            textPartCount = contentCounts.textPartCount,
            imagePartCount = contentCounts.imagePartCount,
            filePartCount = contentCounts.filePartCount,
            cardPartCount = contentCounts.cardPartCount
        )
        is AiChatBreadcrumb.RuntimeHandoffRequested -> aiBreadcrumb(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_REQUESTED,
            workspaceId = workspaceId,
            cardId = cardId,
            bootstrapState = conversationBootstrapState,
            dictationState = dictationState,
            composerPhase = composerPhase,
            message = chatSessionIdBlank.toString(),
            messageCount = messageCount,
            pendingAttachmentCount = pendingAttachmentCount,
            draftLength = draftLength
        )
        is AiChatBreadcrumb.RuntimeHandoffAppliedToRunningDraft -> aiBreadcrumb(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_APPLIED_TO_RUNNING_DRAFT,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cardId = cardId,
            pendingAttachmentCount = pendingAttachmentCount
        )
        is AiChatBreadcrumb.RuntimeHandoffStartFreshConversation -> aiBreadcrumb(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_START_FRESH_CONVERSATION,
            workspaceId = workspaceId,
            cardId = cardId
        )
        is AiChatBreadcrumb.RuntimeHandoffAppliedToExistingSession -> aiBreadcrumb(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_APPLIED_TO_EXISTING_SESSION,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cardId = cardId,
            pendingAttachmentCount = pendingAttachmentCount
        )
    }
}

private fun AiChatWarning.toAndroidEvent(): AndroidWarningIssueEvent {
    return when (this) {
        is AiChatWarning.PostRunSyncFailed -> aiLifecycleWarning(
            name = AndroidAiObservationName.POST_RUN_SYNC_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            composerPhase = null,
            remoteError = null,
            message = aiWarningFailureMessage(reason = reason, error = error)
        )
        is AiChatWarning.PostRunSyncFlagPersistFailed -> aiLifecycleWarning(
            name = AndroidAiObservationName.POST_RUN_SYNC_FLAG_PERSIST_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            composerPhase = null,
            remoteError = null,
            message = aiWarningFailureMessage(reason = reason, error = error)
        )
        is AiChatWarning.WarmUpFailureHandled -> aiLifecycleWarning(
            name = AndroidAiObservationName.WARM_UP_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            composerPhase = null,
            remoteError = remoteError,
            message = message
        )
        is AiChatWarning.SendFailureHandled -> aiSendWarning(
            name = AndroidAiObservationName.SEND_FAILURE_HANDLED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cloudState = cloudState,
            composerPhase = null,
            messageCount = messageCount,
            pendingAttachmentCount = null,
            remoteError = remoteError,
            message = message
        )
        is AiChatWarning.NewChatFailureHandled -> aiLifecycleWarning(
            name = AndroidAiObservationName.NEW_CHAT_FAILURE_HANDLED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            bootstrapState = null,
            composerPhase = null,
            remoteError = remoteError,
            message = message
        )
        is AiChatWarning.ConversationBootstrapFailed -> aiBootstrapWarning(
            name = AndroidAiObservationName.CONVERSATION_BOOTSTRAP_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            remoteError = remoteError,
            message = message
        )
        is AiChatWarning.RuntimeHandoffRejectedNotReady -> aiWarning(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_REJECTED_NOT_READY,
            workspaceId = workspaceId,
            cardId = cardId,
            bootstrapState = conversationBootstrapState,
            dictationState = dictationState
        )
        is AiChatWarning.RuntimeHandoffRejectedLockedPhase -> aiWarning(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_REJECTED_LOCKED_PHASE,
            workspaceId = workspaceId,
            cardId = cardId,
            composerPhase = composerPhase
        )
        is AiChatWarning.RuntimeHandoffRejectedAccessPreparing -> aiWarning(
            name = AndroidAiObservationName.RUNTIME_HANDOFF_REJECTED_ACCESS_PREPARING,
            workspaceId = workspaceId,
            cardId = cardId,
            cloudState = cloudState,
            bootstrapState = conversationBootstrapState
        )
    }
}

private fun AiChatExceptionEvent.toAndroidEvent(): AndroidExceptionIssueEvent {
    return when (this) {
        is AiChatExceptionEvent.WarmUpFailed -> aiLifecycleException(
            name = AndroidAiObservationName.WARM_UP_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            composerPhase = null,
            remoteError = remoteError,
            message = message,
            error = error
        )
        is AiChatExceptionEvent.SendFailureHandled -> aiSendException(
            name = AndroidAiObservationName.SEND_FAILURE_HANDLED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            cloudState = cloudState,
            composerPhase = null,
            messageCount = messageCount,
            pendingAttachmentCount = null,
            remoteError = remoteError,
            message = userFacingMessage,
            error = error
        )
        is AiChatExceptionEvent.NewChatFailureHandled -> aiLifecycleException(
            name = AndroidAiObservationName.NEW_CHAT_FAILURE_HANDLED,
            workspaceId = workspaceId,
            chatSessionId = chatSessionId,
            bootstrapState = null,
            composerPhase = null,
            remoteError = remoteError,
            message = userFacingMessage,
            error = error
        )
        is AiChatExceptionEvent.ConversationBootstrapFailed -> aiBootstrapException(
            name = AndroidAiObservationName.CONVERSATION_BOOTSTRAP_FAILED,
            workspaceId = workspaceId,
            chatSessionId = null,
            bootstrapState = null,
            remoteError = remoteError,
            message = null,
            error = error
        )
    }
}

private fun aiBreadcrumb(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String? = null,
    cardId: String? = null,
    cloudState: String? = null,
    bootstrapState: String? = null,
    composerPhase: String? = null,
    dictationState: String? = null,
    runId: String? = null,
    message: String? = null,
    messageCount: Int? = null,
    pendingAttachmentCount: Int? = null,
    draftLength: Int? = null,
    textPartCount: Int? = null,
    imagePartCount: Int? = null,
    filePartCount: Int? = null,
    cardPartCount: Int? = null
): AndroidBreadcrumbEvent.AiRuntimeBreadcrumb {
    return AndroidBreadcrumbEvent.AiRuntimeBreadcrumb(
        name = name,
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        cardId = cardId,
        cloudState = cloudState,
        bootstrapState = bootstrapState,
        composerPhase = composerPhase,
        dictationState = dictationState,
        runId = runId,
        message = message,
        messageCount = messageCount,
        pendingAttachmentCount = pendingAttachmentCount,
        draftLength = draftLength,
        textPartCount = textPartCount,
        imagePartCount = imagePartCount,
        filePartCount = filePartCount,
        cardPartCount = cardPartCount,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiWarning(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String? = null,
    cardId: String? = null,
    cloudState: String? = null,
    bootstrapState: String? = null,
    composerPhase: String? = null,
    dictationState: String? = null,
    requestId: String? = null,
    statusCode: Int? = null,
    code: String? = null,
    stage: String? = null,
    message: String? = null,
    messageCount: Int? = null,
    pendingAttachmentCount: Int? = null,
    draftLength: Int? = null
): AndroidWarningIssueEvent.AiRuntimeWarning {
    return AndroidWarningIssueEvent.AiRuntimeWarning(
        name = name,
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        cardId = cardId,
        cloudState = cloudState,
        bootstrapState = bootstrapState,
        composerPhase = composerPhase,
        dictationState = dictationState,
        requestId = requestId,
        statusCode = statusCode,
        code = code,
        stage = stage,
        message = message,
        messageCount = messageCount,
        pendingAttachmentCount = pendingAttachmentCount,
        draftLength = draftLength,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiLifecycleWarning(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    bootstrapState: String?,
    composerPhase: String?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?
): AndroidWarningIssueEvent.AiLifecycleWarning {
    return AndroidWarningIssueEvent.AiLifecycleWarning(
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        lifecycleAction = name.tagValue,
        bootstrapState = bootstrapState,
        composerPhase = composerPhase,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiSendWarning(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    cloudState: String?,
    composerPhase: String?,
    messageCount: Int?,
    pendingAttachmentCount: Int?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?
): AndroidWarningIssueEvent.AiSendWarning {
    return AndroidWarningIssueEvent.AiSendWarning(
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        sendAction = name.tagValue,
        cloudState = cloudState,
        composerPhase = composerPhase,
        pendingAttachmentCount = pendingAttachmentCount,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        messageCount = messageCount,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiBootstrapWarning(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    bootstrapState: String?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?
): AndroidWarningIssueEvent.AiBootstrapWarning {
    return AndroidWarningIssueEvent.AiBootstrapWarning(
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        bootstrapAction = name.tagValue,
        bootstrapState = bootstrapState,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiSendException(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    cloudState: String?,
    composerPhase: String?,
    messageCount: Int?,
    pendingAttachmentCount: Int?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?,
    error: Throwable
): AndroidExceptionIssueEvent.AiSendError {
    return AndroidExceptionIssueEvent.AiSendError(
        throwable = error,
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        sendAction = name.tagValue,
        cloudState = cloudState,
        composerPhase = composerPhase,
        pendingAttachmentCount = pendingAttachmentCount,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        messageCount = messageCount,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiLifecycleException(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    bootstrapState: String?,
    composerPhase: String?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?,
    error: Throwable
): AndroidExceptionIssueEvent.AiLifecycleError {
    return AndroidExceptionIssueEvent.AiLifecycleError(
        throwable = error,
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        lifecycleAction = name.tagValue,
        bootstrapState = bootstrapState,
        composerPhase = composerPhase,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}

private fun aiBootstrapException(
    name: AndroidAiObservationName,
    workspaceId: String?,
    chatSessionId: String?,
    bootstrapState: String?,
    remoteError: AiChatRemoteErrorDetails?,
    message: String?,
    error: Throwable
): AndroidExceptionIssueEvent.AiBootstrapError {
    return AndroidExceptionIssueEvent.AiBootstrapError(
        throwable = error,
        workspaceId = workspaceId,
        chatSessionId = chatSessionId,
        bootstrapAction = name.tagValue,
        bootstrapState = bootstrapState,
        requestId = remoteError?.requestId,
        statusCode = remoteError?.statusCode,
        code = remoteError?.code,
        stage = remoteError?.stage,
        message = message,
        appVersion = null,
        clientVersion = null,
        versionCode = null
    )
}
