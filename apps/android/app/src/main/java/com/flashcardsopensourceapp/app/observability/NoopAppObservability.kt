package com.flashcardsopensourceapp.app.observability

import android.util.Log
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationTags
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity

private const val noopObservabilityLogTag: String = "AppObservability"

class NoopAppObservability : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) {
        Log.i(
            noopObservabilityLogTag,
            renderNoopIdentityLogLine(
                eventName = "cloud_identity_set",
                identity = identity
            )
        )
    }

    override fun clearCloudIdentity() {
        Log.i(noopObservabilityLogTag, "event=cloud_identity_cleared platform=android")
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
        Log.i(
            noopObservabilityLogTag,
            renderNoopLogLine(
                prefix = "breadcrumb",
                event = event
            )
        )
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        Log.w(
            noopObservabilityLogTag,
            renderNoopLogLine(
                prefix = "warning",
                event = event
            )
        )
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
        Log.e(
            noopObservabilityLogTag,
            renderNoopExceptionLogLine(event = event)
        )
    }
}

private fun renderNoopIdentityLogLine(
    eventName: String,
    identity: CloudObservationIdentity
): String {
    return "event=$eventName platform=android " +
        renderNoopTags(
            tags = AndroidObservationTags(
                userId = identity.userId,
                workspaceId = identity.workspaceId,
                requestId = null,
                statusCode = null,
                code = null,
                appVersion = identity.appVersion,
                clientVersion = identity.clientVersion,
                versionCode = identity.versionCode
            )
        )
}

private fun renderNoopLogLine(
    prefix: String,
    event: AndroidObservationEvent
): String {
    return "event=$prefix platform=android feature=${event.feature.tagValue} action=${event.action.tagValue} " +
        renderNoopTags(tags = event.tags)
}

private fun renderNoopExceptionLogLine(event: AndroidExceptionIssueEvent): String {
    return renderNoopLogLine(
        prefix = "exception",
        event = event
    ) + " ${renderSanitizedThrowableLogFields(error = event.throwable)}"
}

private fun renderNoopTags(tags: AndroidObservationTags): String {
    return "userId=${sanitizeSentryLogValue(fieldName = "userId", value = tags.userId)} " +
        "workspaceId=${sanitizeSentryLogValue(fieldName = "workspaceId", value = tags.workspaceId)} " +
        "requestId=${sanitizeSentryLogValue(fieldName = "requestId", value = tags.requestId)} " +
        "statusCode=${tags.statusCode?.toString() ?: "null"} " +
        "code=${sanitizeSentryLogValue(fieldName = "code", value = tags.code)} " +
        "appVersion=${sanitizeSentryLogValue(fieldName = "appVersion", value = tags.appVersion)} " +
        "clientVersion=${sanitizeSentryLogValue(fieldName = "clientVersion", value = tags.clientVersion)} " +
        "versionCode=${tags.versionCode?.toString() ?: "null"}"
}
