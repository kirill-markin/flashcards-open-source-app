package com.flashcardsopensourceapp.core.observability

enum class AndroidObservationFeature(
    val tagValue: String
) {
    APP(tagValue = "app"),
    CLOUD(tagValue = "cloud"),
    BACKEND(tagValue = "backend"),
    AUTH(tagValue = "auth"),
    AI(tagValue = "ai"),
    PROGRESS(tagValue = "progress"),
    FEEDBACK(tagValue = "feedback"),
    NOTIFICATIONS(tagValue = "notifications")
}

enum class AndroidObservationAction(
    val tagValue: String
) {
    APP_SCOPE_UNCAUGHT_EXCEPTION(tagValue = "app_scope_uncaught_exception"),
    APP_STARTUP_EXCEPTION(tagValue = "app_startup_exception"),
    APP_TECHNICAL_ERROR_DIALOG_EXCEPTION(tagValue = "app_technical_error_dialog_exception"),
    CLOUD_IDENTITY_SET(tagValue = "cloud_identity_set"),
    CLOUD_IDENTITY_CLEARED(tagValue = "cloud_identity_cleared"),
    EXPECTED_HTTP_FAILURE(tagValue = "expected_http_failure"),
    HTTP_TRANSIENT_RETRY(tagValue = "http_transient_retry"),
    HTTP_5XX_WARNING(tagValue = "http_5xx_warning"),
    HTTP_UNEXPECTED_CLIENT_ERROR(tagValue = "http_unexpected_client_error"),
    AI_STREAM_CRASH(tagValue = "ai_stream_crash"),
    AI_RUNTIME_BREADCRUMB(tagValue = "ai_runtime_breadcrumb"),
    AI_RUNTIME_WARNING(tagValue = "ai_runtime_warning"),
    AI_RUNTIME_ERROR(tagValue = "ai_runtime_error"),
    AI_REMOTE_ERROR(tagValue = "ai_remote_error"),
    AI_LIFECYCLE_WARNING(tagValue = "ai_lifecycle_warning"),
    AI_LIFECYCLE_ERROR(tagValue = "ai_lifecycle_error"),
    AI_SEND_WARNING(tagValue = "ai_send_warning"),
    AI_SEND_ERROR(tagValue = "ai_send_error"),
    AI_BOOTSTRAP_WARNING(tagValue = "ai_bootstrap_warning"),
    AI_BOOTSTRAP_ERROR(tagValue = "ai_bootstrap_error"),
    PROGRESS_REFRESH_WARNING(tagValue = "progress_refresh_warning"),
    PROGRESS_REFRESH_EXCEPTION(tagValue = "progress_refresh_exception"),
    PROGRESS_REPOSITORY_WARNING(tagValue = "progress_repository_warning"),
    PROGRESS_REPOSITORY_EXCEPTION(tagValue = "progress_repository_exception"),
    FEEDBACK_PROMPT_EXCEPTION(tagValue = "feedback_prompt_exception"),
    NOTIFICATION_SCHEDULING_BREADCRUMB(tagValue = "notification_scheduling_breadcrumb"),
    NOTIFICATION_SCHEDULING_WARNING(tagValue = "notification_scheduling_warning")
}

enum class AndroidAiObservationName(
    val tagValue: String
) {
    SWITCH_ACCESS_CONTEXT_CANCELLING_WARM_UP(tagValue = "switch_access_context_cancelling_warm_up"),
    WARM_UP_CANCELLED(tagValue = "warm_up_cancelled"),
    WARM_UP_FAILED(tagValue = "warm_up_failed"),
    CONVERSATION_BOOTSTRAP_CANCELLED(tagValue = "conversation_bootstrap_cancelled"),
    CONVERSATION_BOOTSTRAP_FAILED(tagValue = "conversation_bootstrap_failed"),
    UI_SEND_MESSAGE_REQUESTED(tagValue = "ui_send_message_requested"),
    SEND_FAILURE_HANDLED(tagValue = "send_failure_handled"),
    NEW_CHAT_CANCELLED(tagValue = "new_chat_cancelled"),
    NEW_CHAT_FAILURE_HANDLED(tagValue = "new_chat_failure_handled"),
    POST_RUN_SYNC_FAILED(tagValue = "ai_chat_post_run_sync_failed"),
    POST_RUN_SYNC_FLAG_PERSIST_FAILED(tagValue = "ai_chat_post_run_sync_flag_persist_failed"),
    RUNTIME_HANDOFF_REQUESTED(tagValue = "ai_runtime_handoff_requested"),
    RUNTIME_HANDOFF_REJECTED_NOT_READY(tagValue = "ai_runtime_handoff_rejected_not_ready"),
    RUNTIME_HANDOFF_REJECTED_LOCKED_PHASE(tagValue = "ai_runtime_handoff_rejected_locked_phase"),
    RUNTIME_HANDOFF_REJECTED_ACCESS_PREPARING(tagValue = "ai_runtime_handoff_rejected_access_preparing"),
    RUNTIME_HANDOFF_APPLIED_TO_RUNNING_DRAFT(tagValue = "ai_runtime_handoff_applied_to_running_draft"),
    RUNTIME_HANDOFF_START_FRESH_CONVERSATION(tagValue = "ai_runtime_handoff_start_fresh_conversation"),
    RUNTIME_HANDOFF_APPLIED_TO_EXISTING_SESSION(tagValue = "ai_runtime_handoff_applied_to_existing_session")
}

enum class AndroidFeedbackPromptAction(
    val tagValue: String
) {
    AUTOMATIC_FEEDBACK_STATE_LOAD_FAILED(tagValue = "automatic_feedback_state_load_failed"),
    AUTOMATIC_PROMPT_SHOWN_RECORD_FAILED(tagValue = "automatic_prompt_shown_record_failed")
}

enum class AndroidFeedbackPromptTrigger(
    val tagValue: String
) {
    AUTOMATIC(tagValue = "automatic")
}

data class AndroidObservationTags(
    val userId: String?,
    val workspaceId: String?,
    val requestId: String?,
    val statusCode: Int?,
    val code: String?,
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

data class AndroidWorkInfoStateCounts(
    val enqueued: Int,
    val running: Int,
    val blocked: Int,
    val cancelled: Int,
    val failed: Int,
    val succeeded: Int
)

data class AndroidNotificationSchedulingDiagnostic(
    val notificationKind: String,
    val stage: String,
    val trigger: String?,
    val requestId: String?,
    val workspaceId: String?,
    val permissionAllowed: Boolean?,
    val plannedCount: Int?,
    val workLimit: Int?,
    val appNotificationWorkLimit: Int?,
    val strictReminderWorkLimit: Int?,
    val strictRemindersEnabled: Boolean?,
    val plannedCountEqualsWorkLimit: Boolean?,
    val storedScheduledCountBefore: Int?,
    val storedScheduledCountAfter: Int?,
    val workTag: String?,
    val tagWorkStateCounts: AndroidWorkInfoStateCounts?,
    val expectedWorkStateCounts: AndroidWorkInfoStateCounts?,
    val expectedWorkNameCount: Int?,
    val missingExpectedWorkNameCount: Int?,
    val firstScheduledAtMillis: Long?,
    val lastScheduledAtMillis: Long?,
    val minDelaySeconds: Long?,
    val maxDelaySeconds: Long?,
    val generation: Long?,
    val managerClosed: Boolean?,
    val enqueueRejected: Boolean?
)

sealed interface AndroidObservationEvent {
    val feature: AndroidObservationFeature
    val action: AndroidObservationAction
    val tags: AndroidObservationTags
}

sealed interface AndroidBreadcrumbEvent : AndroidObservationEvent {
    data class CloudIdentitySet(
        val identity: CloudObservationIdentity
    ) : AndroidBreadcrumbEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.CLOUD
        override val action: AndroidObservationAction = AndroidObservationAction.CLOUD_IDENTITY_SET
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = identity.userId,
            workspaceId = identity.workspaceId,
            requestId = null,
            statusCode = null,
            code = null,
            appVersion = identity.appVersion,
            clientVersion = identity.clientVersion,
            versionCode = identity.versionCode
        )
    }

    data class CloudIdentityCleared(
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidBreadcrumbEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.CLOUD
        override val action: AndroidObservationAction = AndroidObservationAction.CLOUD_IDENTITY_CLEARED
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = null,
            statusCode = null,
            code = null,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class ExpectedHttpFailure(
        override val feature: AndroidObservationFeature,
        val endpointName: String,
        val method: String,
        val requestId: String?,
        val statusCode: Int,
        val code: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidBreadcrumbEvent {
        override val action: AndroidObservationAction = AndroidObservationAction.EXPECTED_HTTP_FAILURE
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class HttpTransientRetry(
        override val feature: AndroidObservationFeature,
        val endpointName: String,
        val method: String,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String,
        val attemptNumber: Int,
        val maxAttemptCount: Int,
        val delayMs: Long,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidBreadcrumbEvent {
        override val action: AndroidObservationAction = AndroidObservationAction.HTTP_TRANSIENT_RETRY
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiRuntimeBreadcrumb(
        val name: AndroidAiObservationName,
        val workspaceId: String?,
        val chatSessionId: String?,
        val cardId: String?,
        val cloudState: String?,
        val bootstrapState: String?,
        val composerPhase: String?,
        val dictationState: String?,
        val runId: String?,
        val message: String?,
        val messageCount: Int?,
        val pendingAttachmentCount: Int?,
        val draftLength: Int?,
        val textPartCount: Int?,
        val imagePartCount: Int?,
        val filePartCount: Int?,
        val cardPartCount: Int?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidBreadcrumbEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_RUNTIME_BREADCRUMB
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = null,
            statusCode = null,
            code = name.tagValue,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class NotificationSchedulingBreadcrumb(
        val diagnostic: AndroidNotificationSchedulingDiagnostic,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidBreadcrumbEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.NOTIFICATIONS
        override val action: AndroidObservationAction = AndroidObservationAction.NOTIFICATION_SCHEDULING_BREADCRUMB
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = diagnostic.workspaceId,
            requestId = diagnostic.requestId,
            statusCode = null,
            code = diagnostic.stage,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }
}

sealed interface AndroidWarningIssueEvent : AndroidObservationEvent {
    data class HttpServerError(
        override val feature: AndroidObservationFeature,
        val endpointName: String,
        val method: String,
        val requestId: String?,
        val statusCode: Int,
        val code: String?,
        val stage: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val action: AndroidObservationAction = AndroidObservationAction.HTTP_5XX_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class HttpUnexpectedClientError(
        override val feature: AndroidObservationFeature,
        val endpointName: String,
        val method: String,
        val requestId: String?,
        val statusCode: Int,
        val code: String?,
        val stage: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val action: AndroidObservationAction = AndroidObservationAction.HTTP_UNEXPECTED_CLIENT_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiRemoteError(
        val workspaceId: String?,
        val chatSessionId: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_REMOTE_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiLifecycleWarning(
        val workspaceId: String?,
        val chatSessionId: String?,
        val lifecycleAction: String,
        val bootstrapState: String?,
        val composerPhase: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_LIFECYCLE_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: lifecycleAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiSendWarning(
        val workspaceId: String?,
        val chatSessionId: String?,
        val sendAction: String,
        val cloudState: String?,
        val composerPhase: String?,
        val pendingAttachmentCount: Int?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val messageCount: Int?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_SEND_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: sendAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiBootstrapWarning(
        val workspaceId: String?,
        val chatSessionId: String?,
        val bootstrapAction: String,
        val bootstrapState: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_BOOTSTRAP_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: bootstrapAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class ProgressRefreshWarning(
        val workspaceId: String?,
        val refreshAction: String,
        val scopeId: String?,
        val source: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.PROGRESS
        override val action: AndroidObservationAction = AndroidObservationAction.PROGRESS_REFRESH_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = null,
            statusCode = null,
            code = refreshAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class ProgressRepositoryWarning(
        val workspaceId: String?,
        val repositoryAction: String,
        val scopeId: String?,
        val source: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.PROGRESS
        override val action: AndroidObservationAction = AndroidObservationAction.PROGRESS_REPOSITORY_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = null,
            statusCode = null,
            code = repositoryAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiRuntimeWarning(
        val name: AndroidAiObservationName,
        val workspaceId: String?,
        val chatSessionId: String?,
        val cardId: String?,
        val cloudState: String?,
        val bootstrapState: String?,
        val composerPhase: String?,
        val dictationState: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val messageCount: Int?,
        val pendingAttachmentCount: Int?,
        val draftLength: Int?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_RUNTIME_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: name.tagValue,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class NotificationSchedulingWarning(
        val diagnostic: AndroidNotificationSchedulingDiagnostic,
        val warningReason: String,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidWarningIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.NOTIFICATIONS
        override val action: AndroidObservationAction = AndroidObservationAction.NOTIFICATION_SCHEDULING_WARNING
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = diagnostic.workspaceId,
            requestId = diagnostic.requestId,
            statusCode = null,
            code = warningReason,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }
}

sealed interface AndroidExceptionIssueEvent : AndroidObservationEvent {
    val throwable: Throwable

    data class AppScopeUncaughtException(
        override val throwable: Throwable,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.APP
        override val action: AndroidObservationAction = AndroidObservationAction.APP_SCOPE_UNCAUGHT_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = null,
            statusCode = null,
            code = null,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AppStartupException(
        override val throwable: Throwable,
        val startupPhase: String,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.APP
        override val action: AndroidObservationAction = AndroidObservationAction.APP_STARTUP_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = null,
            statusCode = null,
            code = startupPhase,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AppTechnicalErrorDialogException(
        override val throwable: Throwable,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.APP
        override val action: AndroidObservationAction = AndroidObservationAction.APP_TECHNICAL_ERROR_DIALOG_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = null,
            statusCode = null,
            code = null,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiStreamCrash(
        override val throwable: Throwable,
        val workspaceId: String?,
        val chatSessionId: String?,
        val runId: String?,
        val requestId: String?,
        val code: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_STREAM_CRASH
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = null,
            code = code,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiLifecycleError(
        override val throwable: Throwable,
        val workspaceId: String?,
        val chatSessionId: String?,
        val lifecycleAction: String,
        val bootstrapState: String?,
        val composerPhase: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_LIFECYCLE_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: lifecycleAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiSendError(
        override val throwable: Throwable,
        val workspaceId: String?,
        val chatSessionId: String?,
        val sendAction: String,
        val cloudState: String?,
        val composerPhase: String?,
        val pendingAttachmentCount: Int?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val messageCount: Int?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_SEND_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: sendAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiBootstrapError(
        override val throwable: Throwable,
        val workspaceId: String?,
        val chatSessionId: String?,
        val bootstrapAction: String,
        val bootstrapState: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_BOOTSTRAP_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: bootstrapAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class ProgressRepositoryException(
        override val throwable: Throwable,
        val workspaceId: String?,
        val repositoryAction: String,
        val scopeId: String?,
        val source: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.PROGRESS
        override val action: AndroidObservationAction = AndroidObservationAction.PROGRESS_REPOSITORY_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = null,
            statusCode = null,
            code = repositoryAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class ProgressRefreshException(
        override val throwable: Throwable,
        val workspaceId: String?,
        val refreshAction: String,
        val scopeId: String?,
        val source: String?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.PROGRESS
        override val action: AndroidObservationAction = AndroidObservationAction.PROGRESS_REFRESH_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = null,
            statusCode = null,
            code = refreshAction,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class AiRuntimeException(
        override val throwable: Throwable,
        val name: AndroidAiObservationName,
        val workspaceId: String?,
        val chatSessionId: String?,
        val cardId: String?,
        val cloudState: String?,
        val bootstrapState: String?,
        val composerPhase: String?,
        val dictationState: String?,
        val requestId: String?,
        val statusCode: Int?,
        val code: String?,
        val stage: String?,
        val message: String?,
        val messageCount: Int?,
        val pendingAttachmentCount: Int?,
        val draftLength: Int?,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.AI
        override val action: AndroidObservationAction = AndroidObservationAction.AI_RUNTIME_ERROR
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = workspaceId,
            requestId = requestId,
            statusCode = statusCode,
            code = code ?: name.tagValue,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }

    data class FeedbackPromptException(
        override val throwable: Throwable,
        val promptAction: AndroidFeedbackPromptAction,
        val trigger: AndroidFeedbackPromptTrigger,
        val appVersion: String?,
        val clientVersion: String?,
        val versionCode: Int?
    ) : AndroidExceptionIssueEvent {
        override val feature: AndroidObservationFeature = AndroidObservationFeature.FEEDBACK
        override val action: AndroidObservationAction = AndroidObservationAction.FEEDBACK_PROMPT_EXCEPTION
        override val tags: AndroidObservationTags = AndroidObservationTags(
            userId = null,
            workspaceId = null,
            requestId = null,
            statusCode = null,
            code = promptAction.tagValue,
            appVersion = appVersion,
            clientVersion = clientVersion,
            versionCode = versionCode
        )
    }
}
