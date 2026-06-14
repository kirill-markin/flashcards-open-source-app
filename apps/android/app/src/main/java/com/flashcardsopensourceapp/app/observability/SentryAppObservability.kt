package com.flashcardsopensourceapp.app.observability

import android.util.Log
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidNotificationSchedulingDiagnostic
import com.flashcardsopensourceapp.core.observability.AndroidObservationEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationTags
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWorkInfoStateCounts
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import io.sentry.Breadcrumb
import io.sentry.IScope
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.protocol.User

private const val sentryObservabilityLogTag: String = "AppObservability"

class SentryAppObservability : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) {
        Sentry.configureScope { scope ->
            scope.setTag("platform", "android")
            setOrRemoveOptionalScopeTag(scope = scope, name = "userId", value = identity.userId)
            setOrRemoveOptionalScopeTag(scope = scope, name = "workspaceId", value = identity.workspaceId)
            setOrRemoveOptionalScopeTag(scope = scope, name = "installationId", value = identity.installationId)
            setOrRemoveOptionalScopeTag(scope = scope, name = "appVersion", value = identity.appVersion)
            setOrRemoveOptionalScopeTag(scope = scope, name = "clientVersion", value = identity.clientVersion)
            setOrRemoveOptionalScopeTag(scope = scope, name = "versionCode", value = identity.versionCode?.toString())
            val sentryUserId = identity.userId ?: identity.installationId
            scope.user = User().also { user ->
                user.id = sanitizeSentryIdentifier(value = sentryUserId)
            }
            scope.setContexts(
                "cloud_identity",
                SentryCloudIdentityContext(
                    userId = sanitizeSentryIdentifier(value = identity.userId),
                    workspaceId = sanitizeSentryIdentifier(value = identity.workspaceId),
                    installationId = sanitizeSentryIdentifier(value = identity.installationId),
                    appVersion = sanitizeSentryContextValue(fieldName = "appVersion", value = identity.appVersion),
                    clientVersion = sanitizeSentryContextValue(fieldName = "clientVersion", value = identity.clientVersion),
                    versionCode = identity.versionCode
                )
            )
        }
        logBreadcrumb(action = "cloud_identity_set", tags = AndroidObservationTags(
            userId = identity.userId,
            workspaceId = identity.workspaceId,
            requestId = null,
            statusCode = null,
            code = null,
            appVersion = identity.appVersion,
            clientVersion = identity.clientVersion,
            versionCode = identity.versionCode
        ))
    }

    override fun clearCloudIdentity() {
        Sentry.configureScope { scope ->
            scope.removeTag("userId")
            scope.removeTag("workspaceId")
            scope.removeTag("installationId")
            scope.user = null
            scope.removeContexts("cloud_identity")
        }
        Log.i(sentryObservabilityLogTag, "event=cloud_identity_cleared platform=android")
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
        val breadcrumb = Breadcrumb().also { sentryBreadcrumb ->
            sentryBreadcrumb.category = event.feature.tagValue
            sentryBreadcrumb.message = event.action.tagValue
            sentryBreadcrumb.level = SentryLevel.INFO
            addBreadcrumbData(breadcrumb = sentryBreadcrumb, event = event)
        }
        Sentry.addBreadcrumb(breadcrumb)
        logBreadcrumb(action = event.action.tagValue, tags = event.tags)
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        Log.w(sentryObservabilityLogTag, renderLogLine(prefix = "warning", event = event))
        Sentry.captureMessage(renderWarningIssueMessage(event = event), SentryLevel.WARNING) { scope ->
            applyTags(scope = scope, event = event)
            scope.setFingerprint(warningIssueFingerprint(event = event))
            scope.setContexts("android_observability", warningContext(event = event))
        }
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
        Log.e(
            sentryObservabilityLogTag,
            renderLogLine(prefix = "exception", event = event) +
                " ${renderSanitizedThrowableLogFields(error = event.throwable)}"
        )
        Sentry.captureException(event.throwable) { scope ->
            applyTags(scope = scope, event = event)
            val fingerprint: List<String>? = exceptionIssueFingerprint(event = event)
            if (fingerprint != null) {
                scope.setFingerprint(fingerprint)
            }
            scope.setContexts("android_observability", exceptionContext(event = event))
        }
    }

    private fun applyTags(
        scope: IScope,
        event: AndroidObservationEvent
    ) {
        scope.setTag("platform", "android")
        scope.setTag("feature", event.feature.tagValue)
        scope.setTag("action", event.action.tagValue)
        setOptionalScopeTagIfPresent(scope = scope, name = "userId", value = event.tags.userId)
        setOptionalScopeTagIfPresent(scope = scope, name = "workspaceId", value = event.tags.workspaceId)
        setOptionalScopeTagIfPresent(scope = scope, name = "requestId", value = event.tags.requestId)
        setOptionalScopeTagIfPresent(scope = scope, name = "statusCode", value = event.tags.statusCode?.toString())
        setOptionalScopeTagIfPresent(scope = scope, name = "code", value = event.tags.code)
        setOptionalScopeTagIfPresent(scope = scope, name = "appVersion", value = event.tags.appVersion)
        setOptionalScopeTagIfPresent(scope = scope, name = "clientVersion", value = event.tags.clientVersion)
        setOptionalScopeTagIfPresent(scope = scope, name = "versionCode", value = event.tags.versionCode?.toString())
    }
}

private fun addBreadcrumbData(
    breadcrumb: Breadcrumb,
    event: AndroidBreadcrumbEvent
) {
    breadcrumb.setData("platform", "android")
    breadcrumb.setData("feature", event.feature.tagValue)
    breadcrumb.setData("action", event.action.tagValue)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "userId", value = event.tags.userId)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "workspaceId", value = event.tags.workspaceId)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "requestId", value = event.tags.requestId)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "statusCode", value = event.tags.statusCode?.toString())
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "code", value = event.tags.code)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "appVersion", value = event.tags.appVersion)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "clientVersion", value = event.tags.clientVersion)
    addOptionalBreadcrumbData(breadcrumb = breadcrumb, name = "versionCode", value = event.tags.versionCode?.toString())

    when (event) {
        is AndroidBreadcrumbEvent.CloudIdentitySet -> {
            breadcrumb.setData(
                "cloudIdentity",
                SentryCloudIdentityContext(
                    userId = sanitizeSentryIdentifier(value = event.identity.userId),
                    workspaceId = sanitizeSentryIdentifier(value = event.identity.workspaceId),
                    installationId = sanitizeSentryIdentifier(value = event.identity.installationId),
                    appVersion = sanitizeSentryContextValue(fieldName = "appVersion", value = event.identity.appVersion),
                    clientVersion = sanitizeSentryContextValue(
                        fieldName = "clientVersion",
                        value = event.identity.clientVersion
                    ),
                    versionCode = event.identity.versionCode
                )
            )
        }
        is AndroidBreadcrumbEvent.CloudIdentityCleared -> {
            breadcrumb.setData(
                "cloudIdentity",
                SentryCloudIdentityClearedContext(
                    appVersion = sanitizeSentryContextValue(fieldName = "appVersion", value = event.appVersion),
                    clientVersion = sanitizeSentryContextValue(fieldName = "clientVersion", value = event.clientVersion),
                    versionCode = event.versionCode
                )
            )
        }
        is AndroidBreadcrumbEvent.ExpectedHttpFailure -> {
            breadcrumb.setData(
                "http",
                SentryHttpContext(
                    endpointName = sanitizeSentryContextValue(fieldName = "endpointName", value = event.endpointName),
                    method = sanitizeSentryContextValue(fieldName = "method", value = event.method),
                    requestId = sanitizeSentryIdentifier(value = event.requestId),
                    statusCode = event.statusCode,
                    code = sanitizeSentryContextValue(fieldName = "code", value = event.code),
                    stage = null
                )
            )
        }
        is AndroidBreadcrumbEvent.HttpTransientRetry -> {
            breadcrumb.setData(
                "http",
                SentryHttpContext(
                    endpointName = sanitizeSentryContextValue(fieldName = "endpointName", value = event.endpointName),
                    method = sanitizeSentryContextValue(fieldName = "method", value = event.method),
                    requestId = sanitizeSentryIdentifier(value = event.requestId),
                    statusCode = event.statusCode,
                    code = sanitizeSentryContextValue(fieldName = "code", value = event.code),
                    stage = sanitizeSentryContextValue(fieldName = "stage", value = event.stage)
                )
            )
            breadcrumb.setData(
                "retry",
                SentryHttpRetryContext(
                    attemptNumber = event.attemptNumber,
                    maxAttemptCount = event.maxAttemptCount,
                    delayMs = event.delayMs
                )
            )
        }
        is AndroidBreadcrumbEvent.AiRuntimeBreadcrumb -> {
            breadcrumb.setData(
                "ai",
                SentryAiContext(
                    workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                    chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                    cardId = sanitizeSentryIdentifier(value = event.cardId),
                    runId = sanitizeSentryIdentifier(value = event.runId),
                    aiAction = event.name.tagValue,
                    cloudState = sanitizeSentryContextValue(fieldName = "cloudState", value = event.cloudState),
                    bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                    composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                    dictationState = sanitizeSentryContextValue(fieldName = "dictationState", value = event.dictationState),
                    pendingAttachmentCount = event.pendingAttachmentCount,
                    messageCount = event.messageCount,
                    draftLength = event.draftLength,
                    textPartCount = event.textPartCount,
                    imagePartCount = event.imagePartCount,
                    filePartCount = event.filePartCount,
                    cardPartCount = event.cardPartCount,
                    message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
                )
            )
        }
        is AndroidBreadcrumbEvent.NotificationSchedulingBreadcrumb -> {
            breadcrumb.setData(
                "notifications",
                notificationSchedulingContext(
                    diagnostic = event.diagnostic,
                    warningReason = null
                )
            )
        }
    }
}

private fun warningContext(event: AndroidWarningIssueEvent): SentryAndroidObservationContext {
    return when (event) {
        is AndroidWarningIssueEvent.HttpServerError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = SentryHttpContext(
                endpointName = sanitizeSentryContextValue(fieldName = "endpointName", value = event.endpointName),
                method = sanitizeSentryContextValue(fieldName = "method", value = event.method),
                requestId = sanitizeSentryIdentifier(value = event.requestId),
                statusCode = event.statusCode,
                code = sanitizeSentryContextValue(fieldName = "code", value = event.code),
                stage = sanitizeSentryContextValue(fieldName = "stage", value = event.stage)
            ),
            ai = null,
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.HttpUnexpectedClientError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = SentryHttpContext(
                endpointName = sanitizeSentryContextValue(fieldName = "endpointName", value = event.endpointName),
                method = sanitizeSentryContextValue(fieldName = "method", value = event.method),
                requestId = sanitizeSentryIdentifier(value = event.requestId),
                statusCode = event.statusCode,
                code = sanitizeSentryContextValue(fieldName = "code", value = event.code),
                stage = sanitizeSentryContextValue(fieldName = "stage", value = event.stage)
            ),
            ai = null,
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.AiRemoteError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = SentryHttpContext(
                endpointName = "ai_remote",
                method = null,
                requestId = sanitizeSentryIdentifier(value = event.requestId),
                statusCode = event.statusCode,
                code = sanitizeSentryContextValue(fieldName = "code", value = event.code),
                stage = sanitizeSentryContextValue(fieldName = "stage", value = event.stage)
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = "remote_error",
                cloudState = null,
                bootstrapState = null,
                composerPhase = null,
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = null
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.AiLifecycleWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_lifecycle",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "lifecycleAction", value = event.lifecycleAction),
                cloudState = null,
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.AiSendWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_send",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "sendAction", value = event.sendAction),
                cloudState = sanitizeSentryContextValue(fieldName = "cloudState", value = event.cloudState),
                bootstrapState = null,
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = null,
                pendingAttachmentCount = event.pendingAttachmentCount,
                messageCount = event.messageCount,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.AiBootstrapWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_bootstrap",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "bootstrapAction", value = event.bootstrapAction),
                cloudState = null,
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = null,
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.ProgressRefreshWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = SentryProgressContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                progressAction = sanitizeSentryContextValue(fieldName = "refreshAction", value = event.refreshAction),
                scopeId = sanitizeSentryIdentifier(value = event.scopeId),
                source = sanitizeSentryContextValue(fieldName = "source", value = event.source)
            ),
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.ProgressRepositoryWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = SentryProgressContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                progressAction = sanitizeSentryContextValue(fieldName = "repositoryAction", value = event.repositoryAction),
                scopeId = sanitizeSentryIdentifier(value = event.scopeId),
                source = sanitizeSentryContextValue(fieldName = "source", value = event.source)
            ),
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.AiRuntimeWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_runtime",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = sanitizeSentryIdentifier(value = event.cardId),
                runId = null,
                aiAction = event.name.tagValue,
                cloudState = sanitizeSentryContextValue(fieldName = "cloudState", value = event.cloudState),
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = sanitizeSentryContextValue(fieldName = "dictationState", value = event.dictationState),
                pendingAttachmentCount = event.pendingAttachmentCount,
                messageCount = event.messageCount,
                draftLength = event.draftLength,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidWarningIssueEvent.NotificationSchedulingWarning -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = null,
            notifications = notificationSchedulingContext(
                diagnostic = event.diagnostic,
                warningReason = event.warningReason
            ),
            feedback = null
        )
    }
}

private fun exceptionContext(event: AndroidExceptionIssueEvent): SentryAndroidObservationContext {
    return when (event) {
        is AndroidExceptionIssueEvent.AppScopeUncaughtException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AppStartupException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AiStreamCrash -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_live_stream",
                requestId = event.requestId,
                statusCode = null,
                code = event.code,
                stage = null
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = sanitizeSentryIdentifier(value = event.runId),
                aiAction = "stream_crash",
                cloudState = null,
                bootstrapState = null,
                composerPhase = null,
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = null
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AiLifecycleError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_lifecycle",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "lifecycleAction", value = event.lifecycleAction),
                cloudState = null,
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AiSendError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_send",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "sendAction", value = event.sendAction),
                cloudState = sanitizeSentryContextValue(fieldName = "cloudState", value = event.cloudState),
                bootstrapState = null,
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = null,
                pendingAttachmentCount = event.pendingAttachmentCount,
                messageCount = event.messageCount,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AiBootstrapError -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_bootstrap",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = null,
                runId = null,
                aiAction = sanitizeSentryContextValue(fieldName = "bootstrapAction", value = event.bootstrapAction),
                cloudState = null,
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = null,
                dictationState = null,
                pendingAttachmentCount = null,
                messageCount = null,
                draftLength = null,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.ProgressRefreshException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = SentryProgressContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                progressAction = sanitizeSentryContextValue(fieldName = "refreshAction", value = event.refreshAction),
                scopeId = sanitizeSentryIdentifier(value = event.scopeId),
                source = sanitizeSentryContextValue(fieldName = "source", value = event.source)
            ),
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.ProgressRepositoryException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = SentryProgressContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                progressAction = sanitizeSentryContextValue(fieldName = "repositoryAction", value = event.repositoryAction),
                scopeId = sanitizeSentryIdentifier(value = event.scopeId),
                source = sanitizeSentryContextValue(fieldName = "source", value = event.source)
            ),
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.AiRuntimeException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = aiObservationHttpContext(
                endpointName = "ai_runtime",
                requestId = event.requestId,
                statusCode = event.statusCode,
                code = event.code,
                stage = event.stage
            ),
            ai = SentryAiContext(
                workspaceId = sanitizeSentryIdentifier(value = event.workspaceId),
                chatSessionId = sanitizeSentryIdentifier(value = event.chatSessionId),
                cardId = sanitizeSentryIdentifier(value = event.cardId),
                runId = null,
                aiAction = event.name.tagValue,
                cloudState = sanitizeSentryContextValue(fieldName = "cloudState", value = event.cloudState),
                bootstrapState = sanitizeSentryContextValue(fieldName = "bootstrapState", value = event.bootstrapState),
                composerPhase = sanitizeSentryContextValue(fieldName = "composerPhase", value = event.composerPhase),
                dictationState = sanitizeSentryContextValue(fieldName = "dictationState", value = event.dictationState),
                pendingAttachmentCount = event.pendingAttachmentCount,
                messageCount = event.messageCount,
                draftLength = event.draftLength,
                textPartCount = null,
                imagePartCount = null,
                filePartCount = null,
                cardPartCount = null,
                message = sanitizeSentryContextValue(fieldName = "message", value = event.message)
            ),
            progress = null,
            notifications = null,
            feedback = null
        )
        is AndroidExceptionIssueEvent.FeedbackPromptException -> SentryAndroidObservationContext(
            feature = event.feature.tagValue,
            action = event.action.tagValue,
            http = null,
            ai = null,
            progress = null,
            notifications = null,
            feedback = feedbackPromptContext(event = event)
        )
    }
}

private fun aiObservationHttpContext(
    endpointName: String,
    requestId: String?,
    statusCode: Int?,
    code: String?,
    stage: String?
): SentryHttpContext? {
    if (requestId == null && statusCode == null && code == null && stage == null) {
        return null
    }

    return SentryHttpContext(
        endpointName = endpointName,
        method = null,
        requestId = sanitizeSentryIdentifier(value = requestId),
        statusCode = statusCode,
        code = sanitizeSentryContextValue(fieldName = "code", value = code),
        stage = sanitizeSentryContextValue(fieldName = "stage", value = stage)
    )
}

private fun notificationSchedulingContext(
    diagnostic: AndroidNotificationSchedulingDiagnostic,
    warningReason: String?
): SentryNotificationSchedulingContext {
    return SentryNotificationSchedulingContext(
        notificationKind = sanitizeSentryContextValue(
            fieldName = "notificationKind",
            value = diagnostic.notificationKind
        ),
        stage = sanitizeSentryContextValue(fieldName = "stage", value = diagnostic.stage),
        trigger = sanitizeSentryContextValue(fieldName = "trigger", value = diagnostic.trigger),
        requestId = sanitizeSentryIdentifier(value = diagnostic.requestId),
        workspaceId = sanitizeSentryIdentifier(value = diagnostic.workspaceId),
        permissionAllowed = diagnostic.permissionAllowed,
        plannedCount = diagnostic.plannedCount,
        workLimit = diagnostic.workLimit,
        appNotificationWorkLimit = diagnostic.appNotificationWorkLimit,
        strictReminderWorkLimit = diagnostic.strictReminderWorkLimit,
        strictRemindersEnabled = diagnostic.strictRemindersEnabled,
        plannedCountEqualsWorkLimit = diagnostic.plannedCountEqualsWorkLimit,
        storedScheduledCountBefore = diagnostic.storedScheduledCountBefore,
        storedScheduledCountAfter = diagnostic.storedScheduledCountAfter,
        workTag = sanitizeSentryContextValue(fieldName = "workTag", value = diagnostic.workTag),
        tagWorkStateCounts = sentryWorkInfoStateCounts(counts = diagnostic.tagWorkStateCounts),
        expectedWorkStateCounts = sentryWorkInfoStateCounts(counts = diagnostic.expectedWorkStateCounts),
        expectedWorkNameCount = diagnostic.expectedWorkNameCount,
        missingExpectedWorkNameCount = diagnostic.missingExpectedWorkNameCount,
        firstScheduledAtMillis = diagnostic.firstScheduledAtMillis,
        lastScheduledAtMillis = diagnostic.lastScheduledAtMillis,
        minDelaySeconds = diagnostic.minDelaySeconds,
        maxDelaySeconds = diagnostic.maxDelaySeconds,
        generation = diagnostic.generation,
        managerClosed = diagnostic.managerClosed,
        enqueueRejected = diagnostic.enqueueRejected,
        warningReason = sanitizeSentryContextValue(fieldName = "warningReason", value = warningReason)
    )
}

private fun sentryWorkInfoStateCounts(counts: AndroidWorkInfoStateCounts?): SentryWorkInfoStateCounts? {
    if (counts == null) {
        return null
    }

    return SentryWorkInfoStateCounts(
        enqueued = counts.enqueued,
        running = counts.running,
        blocked = counts.blocked,
        cancelled = counts.cancelled,
        failed = counts.failed,
        succeeded = counts.succeeded
    )
}

private fun setOrRemoveOptionalScopeTag(
    scope: IScope,
    name: String,
    value: String?
) {
    val sanitizedValue = sanitizeSentryTagValue(fieldName = name, value = value)
    if (sanitizedValue == null) {
        scope.removeTag(name)
        return
    }

    scope.setTag(name, sanitizedValue)
}

private fun setOptionalScopeTagIfPresent(
    scope: IScope,
    name: String,
    value: String?
) {
    val sanitizedValue = sanitizeSentryTagValue(fieldName = name, value = value)
    if (sanitizedValue != null) {
        scope.setTag(name, sanitizedValue)
    }
}

private fun addOptionalBreadcrumbData(
    breadcrumb: Breadcrumb,
    name: String,
    value: String?
) {
    val sanitizedValue = sanitizeSentryContextValue(fieldName = name, value = value)
    if (sanitizedValue != null) {
        breadcrumb.setData(name, sanitizedValue)
    }
}

private fun logBreadcrumb(
    action: String,
    tags: AndroidObservationTags
) {
    Log.i(
        sentryObservabilityLogTag,
        "event=$action platform=android userId=${sanitizeSentryLogValue(fieldName = "userId", value = tags.userId)} " +
            "workspaceId=${sanitizeSentryLogValue(fieldName = "workspaceId", value = tags.workspaceId)} " +
            "requestId=${sanitizeSentryLogValue(fieldName = "requestId", value = tags.requestId)} " +
            "statusCode=${tags.statusCode?.toString() ?: "null"} code=${sanitizeSentryLogValue(fieldName = "code", value = tags.code)}"
    )
}

private fun renderLogLine(
    prefix: String,
    event: AndroidObservationEvent
): String {
    return "event=$prefix platform=android feature=${event.feature.tagValue} action=${event.action.tagValue} " +
        "userId=${sanitizeSentryLogValue(fieldName = "userId", value = event.tags.userId)} " +
        "workspaceId=${sanitizeSentryLogValue(fieldName = "workspaceId", value = event.tags.workspaceId)} " +
        "requestId=${sanitizeSentryLogValue(fieldName = "requestId", value = event.tags.requestId)} " +
        "statusCode=${event.tags.statusCode?.toString() ?: "null"} " +
        "code=${sanitizeSentryLogValue(fieldName = "code", value = event.tags.code)} " +
        "appVersion=${sanitizeSentryLogValue(fieldName = "appVersion", value = event.tags.appVersion)} " +
        "clientVersion=${sanitizeSentryLogValue(fieldName = "clientVersion", value = event.tags.clientVersion)} " +
        "versionCode=${event.tags.versionCode?.toString() ?: "null"}"
}

private fun renderWarningIssueMessage(event: AndroidWarningIssueEvent): String {
    val parts = mutableListOf(
        "android",
        event.feature.tagValue,
        event.action.tagValue
    )
    val groupKey = warningIssueGroupKey(event = event)
    if (groupKey != null) {
        parts.add("group_$groupKey")
    }
    val code = sanitizeSentryTagValue(fieldName = "code", value = event.tags.code)
    if (code != null) {
        parts.add("code_$code")
    }
    val statusCode = event.tags.statusCode
    if (statusCode != null) {
        parts.add("status_$statusCode")
    }
    return parts.joinToString(separator = ":")
}

internal fun warningIssueFingerprint(event: AndroidWarningIssueEvent): List<String> {
    val groupKey: String = warningIssueGroupKey(event = event) ?: "no_group"
    val code: String = sanitizeSentryTagValue(fieldName = "code", value = event.tags.code) ?: "no_code"
    val statusCode: String = event.tags.statusCode?.toString() ?: "no_status"
    return listOf(
        "android",
        event.feature.tagValue,
        event.action.tagValue,
        groupKey,
        code,
        statusCode
    )
}

internal fun exceptionIssueFingerprint(event: AndroidExceptionIssueEvent): List<String>? {
    return when (event) {
        is AndroidExceptionIssueEvent.FeedbackPromptException -> listOf(
            "android",
            event.feature.tagValue,
            event.action.tagValue,
            sanitizeSentryTagValue(fieldName = "promptAction", value = event.promptAction.tagValue)
                ?: "no_prompt_action"
        )
        else -> null
    }
}

private fun warningIssueGroupKey(event: AndroidWarningIssueEvent): String? {
    val rawGroupKey = when (event) {
        is AndroidWarningIssueEvent.HttpServerError -> event.endpointName
        is AndroidWarningIssueEvent.HttpUnexpectedClientError -> event.endpointName
        is AndroidWarningIssueEvent.AiRemoteError -> "ai_remote"
        is AndroidWarningIssueEvent.AiLifecycleWarning -> event.lifecycleAction
        is AndroidWarningIssueEvent.AiSendWarning -> event.sendAction
        is AndroidWarningIssueEvent.AiBootstrapWarning -> event.bootstrapAction
        is AndroidWarningIssueEvent.ProgressRefreshWarning -> event.refreshAction
        is AndroidWarningIssueEvent.ProgressRepositoryWarning -> event.repositoryAction
        is AndroidWarningIssueEvent.AiRuntimeWarning -> event.name.tagValue
        is AndroidWarningIssueEvent.NotificationSchedulingWarning -> event.diagnostic.notificationKind
    }
    return sanitizeSentryTagValue(fieldName = "warningGroup", value = rawGroupKey)
}

internal fun feedbackPromptContext(
    event: AndroidExceptionIssueEvent.FeedbackPromptException
): SentryFeedbackContext {
    return SentryFeedbackContext(
        promptAction = sanitizeSentryContextValue(fieldName = "promptAction", value = event.promptAction.tagValue),
        trigger = sanitizeSentryContextValue(fieldName = "trigger", value = event.trigger.tagValue)
    )
}

private data class SentryCloudIdentityContext(
    val userId: String?,
    val workspaceId: String?,
    val installationId: String?,
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

private data class SentryCloudIdentityClearedContext(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

private data class SentryAndroidObservationContext(
    val feature: String,
    val action: String,
    val http: SentryHttpContext?,
    val ai: SentryAiContext?,
    val progress: SentryProgressContext?,
    val notifications: SentryNotificationSchedulingContext?,
    val feedback: SentryFeedbackContext?
)

private data class SentryHttpContext(
    val endpointName: String?,
    val method: String?,
    val requestId: String?,
    val statusCode: Int?,
    val code: String?,
    val stage: String?
)

private data class SentryHttpRetryContext(
    val attemptNumber: Int,
    val maxAttemptCount: Int,
    val delayMs: Long
)

private data class SentryAiContext(
    val workspaceId: String?,
    val chatSessionId: String?,
    val cardId: String?,
    val runId: String?,
    val aiAction: String?,
    val cloudState: String?,
    val bootstrapState: String?,
    val composerPhase: String?,
    val dictationState: String?,
    val pendingAttachmentCount: Int?,
    val messageCount: Int?,
    val draftLength: Int?,
    val textPartCount: Int?,
    val imagePartCount: Int?,
    val filePartCount: Int?,
    val cardPartCount: Int?,
    val message: String?
)

private data class SentryProgressContext(
    val workspaceId: String?,
    val progressAction: String?,
    val scopeId: String?,
    val source: String?
)

internal data class SentryFeedbackContext(
    val promptAction: String?,
    val trigger: String?
)

private data class SentryNotificationSchedulingContext(
    val notificationKind: String?,
    val stage: String?,
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
    val tagWorkStateCounts: SentryWorkInfoStateCounts?,
    val expectedWorkStateCounts: SentryWorkInfoStateCounts?,
    val expectedWorkNameCount: Int?,
    val missingExpectedWorkNameCount: Int?,
    val firstScheduledAtMillis: Long?,
    val lastScheduledAtMillis: Long?,
    val minDelaySeconds: Long?,
    val maxDelaySeconds: Long?,
    val generation: Long?,
    val managerClosed: Boolean?,
    val enqueueRejected: Boolean?,
    val warningReason: String?
)

private data class SentryWorkInfoStateCounts(
    val enqueued: Int,
    val running: Int,
    val blocked: Int,
    val cancelled: Int,
    val failed: Int,
    val succeeded: Int
)
