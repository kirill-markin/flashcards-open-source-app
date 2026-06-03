package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackPromptEventRequest
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackSubmissionRequest
import org.json.JSONObject

internal class CloudFeedbackRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun loadFeedbackState(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudFeedbackState {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/feedback/state",
            authorizationHeader = authorizationHeader
        )
        return parseCloudFeedbackStateResponse(
            response = response,
            fieldPath = "feedback.state"
        )
    }

    suspend fun recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackPromptEventRequest
    ): CloudFeedbackState {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/feedback/prompt-events",
            authorizationHeader = authorizationHeader,
            body = encodeFeedbackPromptEventRequest(request = request)
        )
        return parseCloudFeedbackStateResponse(
            response = response,
            fieldPath = "feedback.promptEvent"
        )
    }

    suspend fun submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackSubmissionRequest
    ): CloudFeedbackState {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/feedback/submissions",
            authorizationHeader = authorizationHeader,
            body = encodeFeedbackSubmissionRequest(request = request)
        )
        return parseCloudFeedbackStateResponse(
            response = response,
            fieldPath = "feedback.submission"
        )
    }
}

private fun parseCloudFeedbackStateResponse(
    response: JSONObject,
    fieldPath: String
): CloudFeedbackState {
    val feedbackState = response.requireCloudObject("feedbackState", "$fieldPath.feedbackState")
    return CloudFeedbackState(
        lastAutomaticPromptShownAtMillis = feedbackState.requireCloudNullableIsoTimestampMillis(
            key = "lastAutomaticPromptShownAt",
            fieldPath = "$fieldPath.feedbackState.lastAutomaticPromptShownAt"
        ),
        lastFeedbackSubmittedAtMillis = feedbackState.requireCloudNullableIsoTimestampMillis(
            key = "lastFeedbackSubmittedAt",
            fieldPath = "$fieldPath.feedbackState.lastFeedbackSubmittedAt"
        ),
        nextAutomaticPromptAtMillis = feedbackState.requireCloudNullableIsoTimestampMillis(
            key = "nextAutomaticPromptAt",
            fieldPath = "$fieldPath.feedbackState.nextAutomaticPromptAt"
        )
    )
}

private fun encodeFeedbackPromptEventRequest(request: CloudFeedbackPromptEventRequest): JSONObject {
    return JSONObject()
        .put("feedbackPromptEventId", request.feedbackPromptEventId)
        .putNullableString(key = "workspaceId", value = request.workspaceId)
        .putNullableString(key = "installationId", value = request.installationId)
        .put("platform", request.platform)
        .putNullableString(key = "appVersion", value = request.appVersion)
        .put("locale", request.locale)
        .put("timezone", request.timezone)
        .put("eventType", request.eventType.wireValue)
        .put("createdAtClient", request.createdAtClient)
}

private fun encodeFeedbackSubmissionRequest(request: CloudFeedbackSubmissionRequest): JSONObject {
    return JSONObject()
        .put("feedbackSubmissionId", request.feedbackSubmissionId)
        .putNullableString(key = "workspaceId", value = request.workspaceId)
        .putNullableString(key = "installationId", value = request.installationId)
        .put("platform", request.platform)
        .putNullableString(key = "appVersion", value = request.appVersion)
        .put("locale", request.locale)
        .put("timezone", request.timezone)
        .put("trigger", request.trigger.wireValue)
        .put("message", request.message)
        .put("createdAtClient", request.createdAtClient)
}
