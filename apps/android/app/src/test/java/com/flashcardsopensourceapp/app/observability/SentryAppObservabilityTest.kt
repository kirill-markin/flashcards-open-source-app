package com.flashcardsopensourceapp.app.observability

import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class SentryAppObservabilityTest {
    @Test
    fun ordinaryIdentifiersStayRawInSentrySanitizers(): Unit {
        val identifiers: Map<String, String> = mapOf(
            "userId" to "user-raw-1",
            "workspaceId" to "workspace-raw-1",
            "cardId" to "card-raw-1",
            "sessionId" to "session-raw-1",
            "runId" to "run-raw-1",
            "installationId" to "installation-raw-1"
        )

        identifiers.forEach { entry: Map.Entry<String, String> ->
            assertEquals(entry.value, sanitizeSentryIdentifier(value = entry.value))
            assertEquals(entry.value, sanitizeSentryTagValue(fieldName = entry.key, value = entry.value))
            assertEquals(entry.value, sanitizeSentryContextValue(fieldName = entry.key, value = entry.value))
            assertEquals(entry.value, sanitizeSentryLogValue(fieldName = entry.key, value = entry.value))
        }
    }

    @Test
    fun ordinaryContentFieldNamesStayRawInSentrySanitizers(): Unit {
        val contentFields: Map<String, String> = mapOf(
            "frontText" to "What is spaced repetition?",
            "backText" to "A scheduling system for memory.",
            "prompt" to "Create a concise flashcard.",
            "body" to "Plain response body text.",
            "attachment" to "attachment-reference-1"
        )

        contentFields.forEach { entry: Map.Entry<String, String> ->
            assertEquals(entry.value, sanitizeSentryContextValue(fieldName = entry.key, value = entry.value))
        }
    }

    @Test
    fun queryParameterSanitizationKeepsOrdinaryIdsAndMasksExplicitSecrets(): Unit {
        val rawQuery: String = listOf(
            "sessionId=s1",
            "runId=r1",
            "workspaceId=w1",
            "userId=u1",
            "installationId=i1",
            "afterCursor=a1",
            "cursor=c1",
            "token=t1",
            "code=c2",
            "email=user@example.test",
            "key=k1",
            "api-key=ak1",
            "api_key=ak2",
            "password=p1",
            "secret=s2"
        ).joinToString(separator = "&")

        val sanitizedQuery: String = sanitizeSentryText(fieldName = "message", value = rawQuery)

        assertEquals(
            "sessionId=s1&runId=r1&workspaceId=w1&userId=u1&installationId=i1&" +
                "afterCursor=a1&cursor=c1&token=[redacted]&code=[redacted]&email=[redacted]&" +
                "key=[redacted]&api-key=[redacted]&api_key=[redacted]&password=[redacted]&secret=[redacted]",
            sanitizedQuery
        )
    }

    @Test
    fun genericPayloadStaysRawWhileExplicitSecretsAreMasked(): Unit {
        val payload: String = "payload: workspaceId=w1 cardId=c1 token=t1 secret=s1"

        val sanitizedPayload: String = sanitizeSentryText(fieldName = "message", value = payload)

        assertEquals(
            "payload: workspaceId=w1 cardId=c1 token=[redacted] secret=[redacted]",
            sanitizedPayload
        )
    }

    @Test
    fun rawHttpBodyLabelsStayRedacted(): Unit {
        val rawBodyLabels: Map<String, String> = mapOf(
            "response body" to "response body: workspaceId=w1 token=t1",
            "raw body" to "raw body: workspaceId=w1 token=t1",
            "raw response" to "raw response: workspaceId=w1 token=t1"
        )

        rawBodyLabels.forEach { entry: Map.Entry<String, String> ->
            assertEquals(
                "${entry.key}: [redacted]",
                sanitizeSentryText(fieldName = "message", value = entry.value)
            )
        }
    }

    @Test
    fun explicitSecretFieldNamesStayRedacted(): Unit {
        val unsafeFieldNames: List<String> = listOf(
            "token",
            "authorization",
            "cookie",
            "email",
            "password",
            "secret",
            "apiKey",
            "apikey",
            "api-key",
            "api_key",
            "queryString",
            "fragment"
        )

        unsafeFieldNames.forEach { fieldName: String ->
            assertEquals("[redacted]", sanitizeSentryContextValue(fieldName = fieldName, value = "secret-value"))
        }
    }

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

private const val testAppVersion: String = "1.9.0"
private const val testVersionCode: Int = 1
