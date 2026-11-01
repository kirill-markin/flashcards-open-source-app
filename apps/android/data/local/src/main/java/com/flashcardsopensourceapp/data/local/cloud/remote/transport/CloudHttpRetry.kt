package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.data.local.network.isNonRetryableTlsFailure
import okhttp3.Protocol
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import kotlin.random.Random

internal const val cloudHttpTransientRetryMaxAttemptCount: Int = 4
internal const val cloudHttpRetryHttpResponseStage: String = "http_response"
internal const val cloudHttpRetryIoExceptionStage: String = "io_exception"
internal const val cloudHttpIoAwaitingResponseHeadersPhase: String = "awaiting_response_headers"

private const val cloudHttpTransientRetryBaseDelayMs: Long = 250L
private const val cloudHttpTransientRetryMaxDelayMs: Long = 2_000L
// OkHttp gives a timed-out HTTP/2 connection one second to answer its degraded ping.
private const val cloudHttp2DegradedPingGraceMs: Long = 1_000L
private val transientCloudHttpStatusCodes: Set<Int> = setOf(408, 429, 500, 502, 503, 504)

internal fun isTransientCloudHttpRetryEligible(
    path: String,
    method: CloudHttpMethod,
    body: JSONObject?
): Boolean {
    if (method == CloudHttpMethod.GET) {
        return true
    }
    if (method != CloudHttpMethod.POST) {
        return false
    }

    val pathOnly = path.substringBefore(delimiter = "?").trim()
    return when {
        pathOnly.endsWith(suffix = "/billing/google/purchases") -> true
        pathOnly.endsWith(suffix = "/me/paywall-shown") -> true
        pathOnly.endsWith(suffix = "/sync/pull") -> true
        pathOnly.endsWith(suffix = "/sync/review-history/pull") -> true
        pathOnly.endsWith(suffix = "/sync/bootstrap") -> body?.optString("mode") == "pull"
        pathOnly.endsWith(suffix = "/packages/export/preview") -> true
        pathOnly.endsWith(suffix = "/packages/export") -> true
        else -> false
    }
}

internal fun shouldRetryTransientCloudHttpResponse(
    retryEligible: Boolean,
    statusCode: Int,
    attemptNumber: Int
): Boolean {
    return retryEligible &&
        transientCloudHttpStatusCodes.contains(element = statusCode) &&
        attemptNumber < cloudHttpTransientRetryMaxAttemptCount
}

internal fun shouldRetryTransientCloudIOException(
    retryEligible: Boolean,
    attemptNumber: Int,
    error: IOException
): Boolean {
    if (isNonRetryableTlsFailure(error = error)) {
        return false
    }
    return retryEligible && attemptNumber < cloudHttpTransientRetryMaxAttemptCount
}

internal fun calculateCloudHttpTransientRetryDelayMs(attemptNumber: Int): Long {
    val exponent = (attemptNumber - 1).coerceAtLeast(0).coerceAtMost(30)
    val exponentialDelayMs = cloudHttpTransientRetryBaseDelayMs * (1L shl exponent)
    val cappedDelayMs = minOf(exponentialDelayMs, cloudHttpTransientRetryMaxDelayMs)
    return if (cappedDelayMs <= 1L) {
        0L
    } else {
        Random.nextLong(until = cappedDelayMs)
    }
}

internal fun calculateCloudHttpIoRetryDelayMs(
    attemptNumber: Int,
    error: IOException,
    connectionProtocol: String?,
    ioPhase: String
): Long {
    val jitterDelayMs = calculateCloudHttpTransientRetryDelayMs(attemptNumber = attemptNumber)
    return if (
        error is SocketTimeoutException &&
        connectionProtocol == Protocol.HTTP_2.toString() &&
        ioPhase == cloudHttpIoAwaitingResponseHeadersPhase
    ) {
        cloudHttp2DegradedPingGraceMs + jitterDelayMs
    } else {
        jitterDelayMs
    }
}
