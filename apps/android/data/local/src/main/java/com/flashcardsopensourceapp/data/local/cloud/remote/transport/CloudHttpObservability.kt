package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudSyncConflictDetails
import okhttp3.Request
import okhttp3.Response

private const val cloudRequestIdHeaderName: String = "X-Request-Id"
private const val cloudAmazonRequestIdHeaderName: String = "X-Amzn-RequestId"
private const val cloudApiGatewayRequestIdHeaderName: String = "X-Amz-Apigw-Id"
private const val cloudHealthValidationPath: String = "/health"
private const val officialCloudApiHost: String = "api.flashcards-open-source-app.com"
private const val officialCloudAuthHost: String = "auth.flashcards-open-source-app.com"

internal data class CloudHttpObservationVersions(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

internal object NoopCloudHttpObservability : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) {
    }

    override fun clearCloudIdentity() {
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
    }
}

internal fun createCloudHttpObservationVersions(
    appVersion: String?,
    versionCode: Int?
): CloudHttpObservationVersions {
    val resolvedAppVersion = appVersion?.trim()?.takeIf { value -> value.isNotEmpty() }
    return CloudHttpObservationVersions(
        appVersion = resolvedAppVersion,
        clientVersion = resolvedAppVersion,
        versionCode = versionCode
    )
}

internal fun readCloudResponseRequestId(response: Response): String? {
    return listOf(
        response.header(cloudRequestIdHeaderName),
        response.header(cloudAmazonRequestIdHeaderName),
        response.header(cloudApiGatewayRequestIdHeaderName)
    ).firstNotNullOfOrNull { value ->
        value?.trim()?.ifEmpty { null }
    }
}

internal fun captureCloudHttpTransientRetryObservation(
    observability: AppObservability,
    observationVersions: CloudHttpObservationVersions,
    request: Request,
    path: String,
    method: String,
    requestId: String?,
    statusCode: Int?,
    code: String?,
    stage: String,
    attemptNumber: Int,
    delayMs: Long
) {
    observability.addBreadcrumb(
        event = AndroidBreadcrumbEvent.HttpTransientRetry(
            feature = cloudObservationFeature(request = request),
            endpointName = cloudObservationEndpointName(path = path),
            method = method,
            requestId = requestId,
            statusCode = statusCode,
            code = code,
            stage = stage,
            attemptNumber = attemptNumber,
            maxAttemptCount = cloudHttpTransientRetryMaxAttemptCount,
            delayMs = delayMs,
            appVersion = observationVersions.appVersion,
            clientVersion = observationVersions.clientVersion,
            versionCode = observationVersions.versionCode
        )
    )
}

internal fun captureCloudHttpFailureObservation(
    observability: AppObservability,
    observationVersions: CloudHttpObservationVersions,
    request: Request,
    path: String,
    method: String,
    requestId: String?,
    statusCode: Int,
    code: String?,
    syncConflict: CloudSyncConflictDetails?
): Boolean {
    val feature = cloudObservationFeature(request = request)
    val endpointName = cloudObservationEndpointName(path = path)
    if (
        isExpectedCloudHealthValidationFailure(
            path = path,
            method = method
        )
    ) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.ExpectedHttpFailure(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return false
    }

    if (statusCode >= 500) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpServerError(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = null,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return true
    }

    if (
        isExpectedCloudHttpFailure(
            statusCode = statusCode,
            code = code,
            syncConflict = syncConflict
        )
    ) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.ExpectedHttpFailure(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return false
    }

    if (statusCode in 400..499) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpUnexpectedClientError(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = null,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return true
    }

    return false
}

internal fun cloudObservationEndpointName(path: String): String {
    val pathOnly = path.substringBefore(delimiter = "?").trim().ifEmpty { "/" }
    val segments = pathOnly.split("/").filter { segment -> segment.isNotEmpty() }
    if (segments.isEmpty()) {
        return "/"
    }

    val normalizedSegments = segments.mapIndexed { index, segment ->
        when {
            index > 0 && segments[index - 1] == "workspaces" -> "{workspaceId}"
            index > 0 && segments[index - 1] == "media-assets" -> "{mediaAssetId}"
            index > 0 && segments[index - 1] == "agent-api-keys" -> "{connectionId}"
            else -> segment
        }
    }
    return "/" + normalizedSegments.joinToString(separator = "/")
}

private fun cloudObservationFeature(request: Request): AndroidObservationFeature {
    val host = request.url.host
    val path = request.url.encodedPath
    return when {
        host == officialCloudAuthHost -> AndroidObservationFeature.AUTH
        path.startsWith(prefix = "/api/") -> AndroidObservationFeature.AUTH
        host == officialCloudApiHost -> AndroidObservationFeature.BACKEND
        else -> AndroidObservationFeature.CLOUD
    }
}

internal fun isExpectedCloudHealthValidationFailure(
    path: String,
    method: String
): Boolean {
    return method == CloudHttpMethod.GET.requestMethod &&
        path.substringBefore(delimiter = "?") == cloudHealthValidationPath
}
