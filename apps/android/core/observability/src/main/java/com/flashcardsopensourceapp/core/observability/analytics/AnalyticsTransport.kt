package com.flashcardsopensourceapp.core.observability.analytics

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

private val analyticsJsonMediaType = "application/json".toMediaType()

private val analyticsClientVersionPattern = Regex("""^\d{1,4}(?:\.\d{1,4}){0,2}""")

internal interface AnalyticsTransport {
    suspend fun sendBatch(
        credential: AnalyticsCredential,
        clientVersion: String?,
        body: String
    ): AnalyticsBatchOutcome
}

/**
 * `platform` and `app_version` are populated only from `X-Client-Platform` and `X-Client-Version`,
 * never from the body, and `product_events` is append-only, so a batch shipped without them is
 * unattributable forever. This client sets these headers nowhere else, so they are set here
 * deliberately rather than inherited from a shared request helper.
 */
internal class OkHttpAnalyticsTransport(
    okHttpClient: OkHttpClient
) : AnalyticsTransport {
    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    override suspend fun sendBatch(
        credential: AnalyticsCredential,
        clientVersion: String?,
        body: String
    ): AnalyticsBatchOutcome {
        val requestBuilder = Request.Builder()
            .url(analyticsEndpointUrl(apiBaseUrl = credential.apiBaseUrl))
            .post(body.toRequestBody(analyticsJsonMediaType))
            .header("Content-Type", "application/json")
            .header("Authorization", credential.authorizationHeader)
            .header("X-Client-Platform", analyticsPlatformHeaderValue)

        val normalizedClientVersion: String? = normalizeAnalyticsClientVersion(value = clientVersion)
        if (normalizedClientVersion != null) {
            requestBuilder.header("X-Client-Version", normalizedClientVersion)
        }

        return withContext(Dispatchers.IO) {
            try {
                httpClient.newCall(requestBuilder.build()).execute().use { response ->
                    readAnalyticsOutcome(response = response)
                }
            } catch (_: IOException) {
                // Offline and other transport failures stay silent on purpose; the batch is kept.
                AnalyticsBatchOutcome.TransportFailure
            }
        }
    }
}

private fun readAnalyticsOutcome(response: Response): AnalyticsBatchOutcome {
    val statusCode: Int = response.code
    return when {
        statusCode == 200 -> parseAnalyticsSuccessBody(responseBody = response.body.string())
        statusCode == 400 || statusCode == 413 -> AnalyticsBatchOutcome.WholeBatchRefused(statusCode = statusCode)
        statusCode == 401 || statusCode == 403 || statusCode == 410 ->
            AnalyticsBatchOutcome.CredentialRefused(statusCode = statusCode)
        else -> AnalyticsBatchOutcome.RetryLater(
            statusCode = statusCode,
            retryAfterMillis = parseAnalyticsRetryAfterMillis(headerValue = response.header("Retry-After"))
        )
    }
}

/**
 * `POST /v1/analytics/events/` answers `404` on purpose and also misses the endpoint's own
 * throttle and alarms, so a base-URL join that normalises to a trailing slash would lose every
 * event silently. The path constant carries no trailing slash and the base URL is trimmed.
 */
internal fun analyticsEndpointUrl(apiBaseUrl: String): String {
    return apiBaseUrl.trim().trimEnd('/') + analyticsEventsPath
}

/** `MAJOR[.MINOR[.PATCH]]`, each part 1-4 digits. Anything else is stored as NULL forever. */
internal fun normalizeAnalyticsClientVersion(value: String?): String? {
    val trimmedValue: String = value?.trim().orEmpty()
    if (trimmedValue.isEmpty()) {
        return null
    }
    return analyticsClientVersionPattern.find(trimmedValue)?.value
}
