package com.flashcardsopensourceapp.app.observability

import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class SentryAppObservabilityTest {
    @Test
    fun warningIssueFingerprintUsesStableWarningDimensions(): Unit {
        val progressWarning: AndroidWarningIssueEvent.ProgressRefreshWarning =
            AndroidWarningIssueEvent.ProgressRefreshWarning(
                workspaceId = "workspace-1",
                refreshAction = "progress_review_schedule_remote_load_failed",
                scopeId = "linked:user-1",
                source = "review_schedule_remote_load",
                appVersion = testAppVersion,
                clientVersion = testAppVersion,
                versionCode = testVersionCode
            )
        val httpWarning: AndroidWarningIssueEvent.HttpUnexpectedClientError =
            AndroidWarningIssueEvent.HttpUnexpectedClientError(
                feature = AndroidObservationFeature.BACKEND,
                endpointName = "/v1/chat",
                method = "POST",
                requestId = "request-1",
                statusCode = 413,
                code = null,
                stage = null,
                appVersion = testAppVersion,
                clientVersion = testAppVersion,
                versionCode = testVersionCode
            )

        assertEquals(
            listOf(
                "android",
                "progress",
                "progress_refresh_warning",
                "progress_review_schedule_remote_load_failed",
                "progress_review_schedule_remote_load_failed",
                "no_status"
            ),
            warningIssueFingerprint(event = progressWarning)
        )
        assertEquals(
            listOf(
                "android",
                "backend",
                "http_unexpected_client_error",
                "/v1/chat",
                "no_code",
                "413"
            ),
            warningIssueFingerprint(event = httpWarning)
        )
    }
}

private const val testAppVersion: String = "1.5.0"
private const val testVersionCode: Int = 1
