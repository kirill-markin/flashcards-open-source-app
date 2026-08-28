package com.flashcardsopensourceapp.core.observability.analytics

import org.json.JSONException
import org.json.JSONObject
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Wire format for `POST /v1/analytics/events`.
 *
 * The shared behavioural constants below are identical on the web and iOS clients by contract; the
 * three clients only stay comparable in the data while they hold the same values.
 */

/** Appended to the configured API base URL. No trailing slash: the server 404s the slashed form. */
internal const val analyticsEventsPath: String = "/analytics/events"

internal const val analyticsPlatformHeaderValue: String = "android"

/** Server limits. */
internal const val analyticsMaxEventsPerBatch: Int = 50
internal const val analyticsMaxEventBytes: Int = 4096
internal const val analyticsMaxRequestBodyBytes: Int = 262_144
internal const val analyticsMaxContextFieldLength: Int = 200

/** Shared behavioural constants. */
internal const val analyticsFlushBatchThreshold: Int = 20
internal const val analyticsMaxQueuedEvents: Int = 5_000
internal const val analyticsMaxQueuedBytes: Long = 5L * 1024L * 1024L
internal const val analyticsQueueTtlMillis: Long = 14L * 24L * 60L * 60L * 1000L
internal const val analyticsSessionTimeoutMillis: Long = 30L * 60L * 1000L
internal const val analyticsInitialRetryDelayMillis: Long = 30L * 1000L
internal const val analyticsMaxRetryDelayMillis: Long = 60L * 60L * 1000L
internal const val analyticsPeriodicFlushIntervalMillis: Long = 5L * 60L * 1000L
internal const val analyticsSustainedServerErrorReportAfterMillis: Long = 60L * 60L * 1000L

/**
 * UTC with a literal `Z`. `OffsetDateTime` readily renders `+02:00` instead, which the server
 * rejects outright: a bad `clientSentAt` 400s the whole batch and a bad `clientOccurredAt` costs
 * that event. The formatter is pinned to [ZoneOffset.UTC] with a quoted `Z` so no device time zone
 * can leak an offset into the payload.
 */
private val analyticsTimestampFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

internal fun formatAnalyticsTimestamp(epochMillis: Long): String {
    return analyticsTimestampFormatter.format(Instant.ofEpochMilli(epochMillis))
}

private val analyticsRandom: SecureRandom = SecureRandom()

/**
 * UUID **version 7**. `UUID.randomUUID()` produces version 4, which the endpoint refuses because
 * `event_id` is the primary key of an append-only table that depends on time-ordered inserts. The
 * refusal arrives as the generic `invalid_event`, so getting this wrong is silent on the client.
 *
 * Layout: 48-bit big-endian millisecond timestamp, 4-bit version `7`, 12 random bits, 2-bit
 * variant `0b10`, 62 random bits.
 */
internal fun newAnalyticsEventId(epochMillis: Long): String {
    val timestamp: Long = epochMillis.coerceAtLeast(0L) and 0x0000_FFFF_FFFF_FFFFL
    val randomA: Long = analyticsRandom.nextInt(0x1000).toLong()
    val mostSignificantBits: Long = (timestamp shl 16) or (0x7L shl 12) or randomA
    val leastSignificantBits: Long = (analyticsRandom.nextLong() and 0x3FFF_FFFF_FFFF_FFFFL) or Long.MIN_VALUE
    return UUID(mostSignificantBits, leastSignificantBits).toString()
}

/** A lowercase UUID with no version requirement, used for `anonymousId` and `sessionId`. */
internal fun newAnalyticsUuid(): String {
    return UUID.randomUUID().toString()
}

/** Describes the device at flush time and is sent once per batch. */
data class AnalyticsDeviceContext(
    val osVersion: String?,
    val deviceModel: String?,
    val deviceLocale: String?,
    val timezone: String?
)

internal data class AnalyticsSerializedEvent(
    val eventId: String,
    val eventName: String,
    val json: String,
    val byteSize: Int
)

/**
 * Renders one event object. Every optional key is written explicitly, with a real JSON null where
 * there is no value, so all three clients produce identical wire output.
 */
internal fun serializeAnalyticsEvent(
    event: AnalyticsEvent,
    eventId: String,
    occurredAtMillis: Long,
    networkState: AnalyticsNetworkState?
): AnalyticsSerializedEvent {
    val properties = JSONObject()
    event.properties.forEach { (propertyName, propertyValue) ->
        when (propertyValue) {
            is AnalyticsPropertyValue.Text -> properties.put(propertyName, propertyValue.value)
            is AnalyticsPropertyValue.Count -> properties.put(propertyName, propertyValue.value)
        }
    }

    val eventJson = JSONObject()
        .put("eventId", eventId)
        .put("eventName", event.eventName)
        .put("clientOccurredAt", formatAnalyticsTimestamp(epochMillis = occurredAtMillis))
        .put("networkState", networkState?.wireValue ?: JSONObject.NULL)
        .put("screen", event.screen?.wireValue ?: JSONObject.NULL)
        // An event with no declared properties still sends an object: a strict object with no
        // members accepts `{}` unambiguously.
        .put("properties", properties)
        // The product has no experiment system yet; the field is always an explicit null.
        .put("experimentAssignments", JSONObject.NULL)
        .toString()

    return AnalyticsSerializedEvent(
        eventId = eventId,
        eventName = event.eventName,
        json = eventJson,
        byteSize = eventJson.toByteArray(Charsets.UTF_8).size
    )
}

/**
 * Builds the batch envelope. `clientSentAt` is stamped at request time, never at event creation
 * time: the server derives `occurred_at` from the interval between the two, so a stale
 * `clientSentAt` silently corrupts every timestamp in the batch.
 */
internal fun renderAnalyticsBatchBody(
    clientSentAtMillis: Long,
    anonymousId: String?,
    sessionId: String?,
    deviceContext: AnalyticsDeviceContext?,
    eventJsonPayloads: List<String>
): String {
    val body = StringBuilder()
    body.append("{\"clientSentAt\":")
    body.append(JSONObject.quote(formatAnalyticsTimestamp(epochMillis = clientSentAtMillis)))
    body.append(",\"anonymousId\":")
    body.append(anonymousId?.let { value -> JSONObject.quote(value) } ?: "null")
    body.append(",\"sessionId\":")
    body.append(sessionId?.let { value -> JSONObject.quote(value) } ?: "null")
    body.append(",\"context\":")
    body.append(renderAnalyticsContextJson(deviceContext = deviceContext))
    body.append(",\"events\":[")
    eventJsonPayloads.forEachIndexed { index, eventJson ->
        if (index > 0) {
            body.append(',')
        }
        body.append(eventJson)
    }
    body.append("]}")
    return body.toString()
}

private fun renderAnalyticsContextJson(deviceContext: AnalyticsDeviceContext?): String {
    if (deviceContext == null) {
        return "null"
    }

    return JSONObject()
        .put("osVersion", clampAnalyticsContextField(value = deviceContext.osVersion))
        .put("deviceModel", clampAnalyticsContextField(value = deviceContext.deviceModel))
        .put("deviceLocale", clampAnalyticsContextField(value = deviceContext.deviceLocale))
        .put("timezone", clampAnalyticsContextField(value = deviceContext.timezone))
        .toString()
}

private fun clampAnalyticsContextField(value: String?): Any {
    val trimmedValue: String = value?.trim().orEmpty()
    if (trimmedValue.isEmpty()) {
        return JSONObject.NULL
    }
    return trimmedValue.take(analyticsMaxContextFieldLength)
}

/** What the client must do with the answer, per the response rules of the wire contract. */
internal sealed interface AnalyticsBatchOutcome {
    /** `200`. The batch is finished: every event sent is purged, rejected or not. */
    data class Finished(val acceptedCount: Int, val rejectedCount: Int) : AnalyticsBatchOutcome

    /** `400` / `413`. Whole-batch refusal with no per-event report; the same bytes never succeed. */
    data class WholeBatchRefused(val statusCode: Int) : AnalyticsBatchOutcome

    /** `429` / `5xx`. Keep everything and retry later. */
    data class RetryLater(val statusCode: Int, val retryAfterMillis: Long?) : AnalyticsBatchOutcome

    /** `401` / `403` / `410`. Keep the events queued against a future valid credential. */
    data class CredentialRefused(val statusCode: Int) : AnalyticsBatchOutcome

    /** Offline or another transport failure. Deliberately silent; keep everything. */
    data object TransportFailure : AnalyticsBatchOutcome
}

internal fun parseAnalyticsSuccessBody(responseBody: String?): AnalyticsBatchOutcome.Finished {
    if (responseBody.isNullOrBlank()) {
        return AnalyticsBatchOutcome.Finished(acceptedCount = 0, rejectedCount = 0)
    }

    return try {
        val json = JSONObject(responseBody)
        AnalyticsBatchOutcome.Finished(
            acceptedCount = json.optInt("accepted", 0),
            rejectedCount = json.optJSONArray("rejected")?.length() ?: 0
        )
    } catch (_: JSONException) {
        // A 200 finishes the batch even when the body cannot be read; the events are still purged.
        AnalyticsBatchOutcome.Finished(acceptedCount = 0, rejectedCount = 0)
    }
}

/**
 * `Retry-After` is an optimisation, never a precondition: only the analytics writer's own
 * saturation refusal sets it, while a gateway throttle refusal never does. When it is absent the
 * caller falls back to local exponential backoff with full jitter.
 */
internal fun parseAnalyticsRetryAfterMillis(headerValue: String?): Long? {
    val trimmedValue: String = headerValue?.trim().orEmpty()
    if (trimmedValue.isEmpty()) {
        return null
    }

    val seconds: Long? = trimmedValue.toLongOrNull()
    if (seconds != null) {
        return (seconds * 1000L).coerceIn(0L, analyticsMaxRetryDelayMillis)
    }

    return null
}
