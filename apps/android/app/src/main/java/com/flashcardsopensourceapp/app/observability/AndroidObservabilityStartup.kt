package com.flashcardsopensourceapp.app.observability

import android.app.Application
import com.flashcardsopensourceapp.app.BuildConfig
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.network.TracePropagationTarget
import io.sentry.BaggageHeader
import io.sentry.Breadcrumb
import io.sentry.ISpan
import io.sentry.Sentry
import io.sentry.SentryEvent
import io.sentry.SentryOptions
import io.sentry.SentryTraceHeader
import io.sentry.SpanDataConvention
import io.sentry.android.core.SentryAndroid
import io.sentry.okhttp.SentryOkHttpEventListener
import io.sentry.okhttp.SentryOkHttpInterceptor
import io.sentry.protocol.Message
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request

private const val flashcardsOfficialLiveLambdaHostSuffix: String = ".lambda-url.eu-central-1.on.aws"
private const val flashcardsOfficialApiTraceTarget: String =
    "^https://api\\.flashcards-open-source-app\\.com/v1(?:/.*)?$"
private const val flashcardsOfficialAuthTraceTarget: String =
    "^https://auth\\.flashcards-open-source-app\\.com/.*$"
private const val sentryHttpUrlSpanDataKey: String = "http.url"
private const val sentryUrlFullSpanDataKey: String = "url.full"
private const val sentryUrlSpanDataKey: String = "url"

data class AndroidObservabilityStartup(
    val observability: AppObservability,
    val okHttpClient: OkHttpClient
)

fun startAndroidObservability(application: Application): AndroidObservabilityStartup {
    val sentryDsn = BuildConfig.ANDROID_SENTRY_DSN.trim()
    val isSentryEnabled = sentryDsn.isNotBlank()
    SentryAndroid.init(application) { options ->
        configureSentryOptions(
            options = options,
            sentryDsn = sentryDsn
        )
    }

    return AndroidObservabilityStartup(
        observability = if (isSentryEnabled) {
            SentryAppObservability()
        } else {
            NoopAppObservability()
        },
        okHttpClient = buildAppOkHttpClient(isSentryEnabled = isSentryEnabled)
    )
}

private fun configureSentryOptions(
    options: io.sentry.android.core.SentryAndroidOptions,
    sentryDsn: String
) {
    if (sentryDsn.isBlank()) {
        options.isEnabled = false
        return
    }

    options.dsn = sentryDsn
    options.release = "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
    options.dist = BuildConfig.VERSION_CODE.toString()
    options.environment = sentryEnvironment()
    options.setSendDefaultPii(false)
    options.setMaxRequestBodySize(SentryOptions.RequestSize.NONE)
    options.setAttachScreenshot(false)
    options.setAttachViewHierarchy(false)
    options.setProfilesSampleRate(0.0)
    options.setTracesSampleRate(BuildConfig.ANDROID_SENTRY_TRACES_SAMPLE_RATE)
    options.setTracePropagationTargets(sentryTracePropagationTargets())
    options.logs.setEnabled(false)
    options.setBeforeSend { event, _ ->
        sanitizeSentryEvent(event = event)
    }
    options.setBeforeBreadcrumb { breadcrumb, _ ->
        sanitizeSentryBreadcrumb(breadcrumb = breadcrumb)
    }
}

private fun sentryEnvironment(): String {
    val overrideEnvironment = androidSentryEnvironmentOverride()
    if (overrideEnvironment != null) {
        return overrideEnvironment
    }

    val configuredEnvironment = BuildConfig.ANDROID_SENTRY_ENVIRONMENT.trim()
    if (configuredEnvironment.isNotEmpty()) {
        return configuredEnvironment
    }

    return if (BuildConfig.BUILD_TYPE == "release") {
        "production"
    } else {
        "local"
    }
}

private fun buildAppOkHttpClient(isSentryEnabled: Boolean): OkHttpClient {
    val builder = OkHttpClient.Builder()
    if (isSentryEnabled) {
        builder.eventListener(SentryOkHttpEventListener())
        builder.addInterceptor(sentryOkHttpInterceptor())
        builder.addInterceptor(sentryLiveTracePropagationInterceptor())
    }
    return builder.build()
}

private fun sentryOkHttpInterceptor(): SentryOkHttpInterceptor {
    return SentryOkHttpInterceptor(
        beforeSpan = SentryOkHttpInterceptor.BeforeSpanCallback { span, _, _ ->
            sanitizeOkHttpSentrySpan(span = span)
        },
        captureFailedRequests = false
    )
}

private fun sanitizeOkHttpSentrySpan(span: ISpan): ISpan {
    span.setDescription(sanitizeSentryUrl(value = span.description))
    span.setData(SpanDataConvention.HTTP_QUERY_KEY, null)
    span.setData(SpanDataConvention.HTTP_FRAGMENT_KEY, null)
    sanitizeOkHttpSentrySpanUrlData(span = span, dataKey = sentryHttpUrlSpanDataKey)
    sanitizeOkHttpSentrySpanUrlData(span = span, dataKey = sentryUrlFullSpanDataKey)
    sanitizeOkHttpSentrySpanUrlData(span = span, dataKey = sentryUrlSpanDataKey)
    return span
}

private fun sanitizeOkHttpSentrySpanUrlData(
    span: ISpan,
    dataKey: String
) {
    val value = span.getData(dataKey) as? String ?: return
    span.setData(dataKey, sanitizeSentryUrl(value = value))
}

private fun sentryTracePropagationTargets(): List<String> {
    return listOf(
        flashcardsOfficialApiTraceTarget,
        flashcardsOfficialAuthTraceTarget
    )
}

private fun sentryLiveTracePropagationInterceptor(): Interceptor {
    return Interceptor { chain ->
        val request: Request = chain.request()
        if (shouldAttachLiveSentryTraceHeaders(request = request).not()) {
            return@Interceptor chain.proceed(request)
        }

        val requestWithTraceHeaders: Request = addSentryTraceHeaders(request = request)
        chain.proceed(requestWithTraceHeaders)
    }
}

private fun shouldAttachLiveSentryTraceHeaders(request: Request): Boolean {
    if (request.url.scheme != "https") {
        return false
    }

    return isOfficialAiLiveRequest(request = request)
}

private fun isOfficialAiLiveRequest(request: Request): Boolean {
    if (request.tag(TracePropagationTarget::class.java) != TracePropagationTarget.OFFICIAL_AI_LIVE) {
        return false
    }
    if (request.url.host.endsWith(suffix = flashcardsOfficialLiveLambdaHostSuffix).not()) {
        return false
    }
    if (request.header("Accept") != "text/event-stream") {
        return false
    }

    return request.header("Authorization")?.startsWith(prefix = "Live ") == true
}

private fun addSentryTraceHeaders(request: Request): Request {
    val sentryTraceHeader: SentryTraceHeader? = Sentry.getTraceparent()
    val baggageHeader: BaggageHeader? = Sentry.getBaggage()
    if (sentryTraceHeader == null && baggageHeader == null) {
        return request
    }

    val builder: Request.Builder = request.newBuilder()
    if (sentryTraceHeader != null) {
        builder.header(sentryTraceHeader.name, sentryTraceHeader.value)
    }
    if (baggageHeader != null) {
        builder.header(baggageHeader.name, baggageHeader.value)
    }

    return builder.build()
}

private fun sanitizeSentryEvent(event: SentryEvent): SentryEvent {
    val request = event.request
    if (request != null) {
        request.url = sanitizeSentryUrl(value = request.url)
        request.queryString = sanitizeSentryQueryString(value = request.queryString)
        request.fragment = null
        request.data = null
        request.cookies = null
        request.headers = request.headers?.let(::sanitizeHeaders)
        request.envs = request.envs?.let(::sanitizeHeaders)
        request.others = request.others?.let(::sanitizeHeaders)
    }

    event.breadcrumbs?.forEach { breadcrumb ->
        sanitizeSentryBreadcrumb(breadcrumb = breadcrumb)
    }

    sanitizeEventMessage(message = event.message)
    event.exceptions?.forEach { exception ->
        exception.value = exception.value?.let { "[redacted-exception-message]" }
        val mechanism = exception.mechanism
        if (mechanism != null) {
            mechanism.description = mechanism.description?.let { description ->
                sanitizeSentryText(fieldName = "mechanismDescription", value = description)
            }
            mechanism.data = mechanism.data?.let(::sanitizeObjectMap)
            mechanism.meta = mechanism.meta?.let(::sanitizeObjectMap)
        }
    }

    val user = event.user
    if (user != null) {
        user.email = null
        user.username = null
        user.ipAddress = null
    }

    val response = event.contexts.response
    if (response != null) {
        response.cookies = null
        response.data = null
        response.headers = response.headers?.let(::sanitizeHeaders)
    }

    event.tags = event.tags?.let(::sanitizeHeaders)
    event.extras = event.extras?.let(::sanitizeObjectMap)

    return event
}

private fun sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb? {
    val data = breadcrumb.data
    val keysToRemove = data.keys.filter(::isUnsafeSentryFieldName)
    keysToRemove.forEach { key ->
        breadcrumb.removeData(key)
    }
    data.keys.forEach { key ->
        val value = data[key]
        if (value is String) {
            val sanitizedValue = if (key.contains(other = "url", ignoreCase = true)) {
                sanitizeSentryUrl(value = value) ?: "[redacted]"
            } else {
                sanitizeSentryText(fieldName = key, value = value)
            }
            breadcrumb.setData(key, sanitizedValue)
        }
    }
    breadcrumb.message = breadcrumb.message?.let { message ->
        sanitizeSentryText(fieldName = "message", value = message)
    }
    return breadcrumb
}

private fun sanitizeHeaders(headers: Map<String, String>): Map<String, String> {
    return headers.mapValues { entry ->
        if (isUnsafeSentryFieldName(fieldName = entry.key)) {
            "[redacted]"
        } else if (entry.key.contains(other = "url", ignoreCase = true)) {
            sanitizeSentryUrl(value = entry.value) ?: "[redacted]"
        } else {
            sanitizeSentryText(fieldName = entry.key, value = entry.value)
        }
    }
}

private fun sanitizeEventMessage(message: Message?) {
    if (message == null) {
        return
    }
    message.formatted = message.formatted?.let { value ->
        sanitizeSentryText(fieldName = "messageFormatted", value = value)
    }
    message.message = message.message?.let { value ->
        sanitizeSentryText(fieldName = "message", value = value)
    }
    message.params = message.params?.map { value ->
        sanitizeSentryText(fieldName = "messageParam", value = value)
    }
}

private fun sanitizeObjectMap(fields: Map<String, Any>): Map<String, Any> {
    return fields.mapNotNull { entry ->
        if (isUnsafeSentryFieldName(fieldName = entry.key)) {
            null
        } else {
            val sanitizedValue = sanitizeObjectValue(fieldName = entry.key, value = entry.value)
            entry.key to sanitizedValue
        }
    }.toMap()
}

private fun sanitizeObjectValue(
    fieldName: String,
    value: Any
): Any {
    return when (value) {
        is String -> {
            if (fieldName.contains(other = "url", ignoreCase = true)) {
                sanitizeSentryUrl(value = value) ?: "[redacted]"
            } else {
                sanitizeSentryText(fieldName = fieldName, value = value)
            }
        }
        is Map<*, *> -> sanitizeUntypedMap(fields = value)
        else -> value
    }
}

private fun sanitizeUntypedMap(fields: Map<*, *>): Map<String, Any> {
    return fields.mapNotNull { entry ->
        val key = entry.key as? String
        val value = entry.value
        if (key == null || value == null || isUnsafeSentryFieldName(fieldName = key)) {
            null
        } else {
            key to sanitizeObjectValue(fieldName = key, value = value)
        }
    }.toMap()
}
