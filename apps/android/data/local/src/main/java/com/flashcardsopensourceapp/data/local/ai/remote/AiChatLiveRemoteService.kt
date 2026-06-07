package com.flashcardsopensourceapp.data.local.ai.remote

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.wire.AiChatLiveEventPayloadDecodeResult
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatLiveEventPayloadResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.network.TracePropagationTarget
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.job
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.EOFException
import java.io.IOException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

const val aiChatLiveStreamEndedBeforeTerminalCode: String = "ai_live_stream_ended_before_terminal"
const val aiChatLiveStreamReadFailedCode: String = "ai_live_stream_read_failed"

class AiChatLiveStreamException(
    message: String,
    val requestId: String?,
    val code: String,
    cause: Throwable
) : IOException(message, cause)

/**
 * Owns the low-level live SSE transport for Android AI chat.
 * Snapshot/bootstrap remains the source of truth; this service only opens the
 * temporary live overlay, validates the SSE wire payloads, and stops when the
 * caller no longer wants more events.
 */
class AiChatLiveRemoteService private constructor(
    private val dispatchers: AiCoroutineDispatchers,
    okHttpClient: OkHttpClient,
    private val observability: AppObservability,
    private val observationVersions: AiChatHttpObservationVersions
) {
    constructor(
        dispatchers: AiCoroutineDispatchers,
        okHttpClient: OkHttpClient,
        observability: AppObservability,
        appVersion: String,
        versionCode: Int
    ) : this(
        dispatchers = dispatchers,
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = createAiChatHttpObservationVersions(
            appVersion = appVersion,
            versionCode = versionCode
        )
    )

    constructor(
        dispatchers: AiCoroutineDispatchers,
        okHttpClient: OkHttpClient
    ) : this(
        dispatchers = dispatchers,
        okHttpClient = okHttpClient,
        observability = NoopAiChatHttpObservability,
        observationVersions = createAiChatHttpObservationVersions(
            appVersion = null,
            versionCode = null
        )
    )

    constructor(dispatchers: AiCoroutineDispatchers) : this(
        dispatchers = dispatchers,
        okHttpClient = OkHttpClient()
    )

    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(600, TimeUnit.SECONDS)
        .build()

    fun attachLiveRun(
        authorizationHeader: String,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        workspaceId: String?,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        return attachLiveRun(
            authorizationHeader = authorizationHeader,
            sessionId = sessionId,
            runId = runId,
            liveStream = liveStream,
            workspaceId = workspaceId,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            allowOfficialLiveTracePropagation = false
        )
    }

    fun attachLiveRun(
        authorizationHeader: String,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        workspaceId: String?,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        allowOfficialLiveTracePropagation: Boolean
    ): Flow<AiChatLiveEvent> = flow {
        val usesSignedLiveAuthorization = liveStream.authorization.startsWith(prefix = "Live ")
        val authorization = if (usesSignedLiveAuthorization) {
            liveStream.authorization
        } else {
            authorizationHeader
        }
        connectLiveStream(
            liveUrl = liveStream.url,
            authorization = authorization,
            sessionId = sessionId,
            runId = runId,
            workspaceId = if (usesSignedLiveAuthorization) {
                null
            } else {
                requireFallbackWorkspaceId(workspaceId = workspaceId)
            },
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            allowOfficialLiveTracePropagation = allowOfficialLiveTracePropagation,
            emitEvent = { event ->
                emit(event)
                event !is AiChatLiveEvent.RunTerminal
            }
        )
    }.flowOn(dispatchers.io)

    private fun truncatedPayloadSnippet(payload: String): String {
        val trimmedPayload = payload.trim()
        return if (trimmedPayload.length <= 240) {
            trimmedPayload
        } else {
            trimmedPayload.take(n = 240)
        }
    }

    private suspend fun emitDecodedPayload(
        currentEventType: String?,
        payload: String,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        emitEvent: suspend (AiChatLiveEvent) -> Boolean
    ): Boolean {
        return when (val decodingResult = decodeAiChatLiveEventPayloadResult(eventType = currentEventType, payload = payload)) {
            is AiChatLiveEventPayloadDecodeResult.Event -> emitEvent(decodingResult.event)
            is AiChatLiveEventPayloadDecodeResult.IgnoredUnknownType -> {
                AiChatDiagnosticsLogger.warn(
                    event = "ai_live_event_skipped_unknown_type",
                    fields = listOf(
                        "sessionId" to sessionId,
                        "runId" to runId,
                        "afterCursor" to afterCursor,
                        "eventType" to decodingResult.eventType,
                        "payloadSnippet" to truncatedPayloadSnippet(payload = payload)
                    )
                )
                true
            }
        }
    }

    @OptIn(InternalCoroutinesApi::class)
    private suspend fun connectLiveStream(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        runId: String,
        workspaceId: String?,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        allowOfficialLiveTracePropagation: Boolean,
        emitEvent: suspend (AiChatLiveEvent) -> Boolean
    ) {
        val urlString = buildLiveUrl(
            liveUrl = liveUrl,
            sessionId = sessionId,
            runId = runId,
            workspaceId = workspaceId,
            afterCursor = afterCursor
        )
        val requestBuilder = Request.Builder()
            .url(urlString)
            .get()
            .cacheControl(CacheControl.FORCE_NETWORK)
            .header("Accept", "text/event-stream")
            .header("Authorization", authorization)
        if (allowOfficialLiveTracePropagation) {
            requestBuilder.tag(TracePropagationTarget::class.java, TracePropagationTarget.OFFICIAL_AI_LIVE)
        }
        if (resumeDiagnostics != null) {
            requestBuilder.header(
                "X-Chat-Resume-Attempt-Id",
                resumeDiagnostics.resumeAttemptId.toString()
            )
            requestBuilder.header("X-Client-Platform", resumeDiagnostics.clientPlatform)
            requestBuilder.header("X-Client-Version", resumeDiagnostics.clientVersion)
        }
        val call = httpClient.newCall(requestBuilder.build())
        val coroutineJob = currentCoroutineContext().job
        val cancellationRequested = AtomicBoolean(false)
        val cancellationHandle = coroutineJob.invokeOnCompletion(
            onCancelling = true,
            invokeImmediately = true
        ) { cause ->
            if (cause != null) {
                cancellationRequested.set(true)
                call.cancel()
            }
        }

        try {
            call.awaitOkHttpResponse().use { response ->
                if (response.isSuccessful.not()) {
                    val responseBody = readAiChatResponseBody(response = response)
                    throw readAiChatRemoteErrorResponse(
                        response = response,
                        responseBody = responseBody,
                        observability = observability,
                        observationVersions = observationVersions
                    )
                }

                val requestId = readAiChatRequestIdHeader(response = response)
                try {
                    val responseBody = response.body
                    var currentEventType: String? = null
                    val dataLines = mutableListOf<String>()

                    responseBody.byteStream().bufferedReader(StandardCharsets.UTF_8).use { reader ->
                        var line: String? = reader.readLine()
                        while (line != null) {
                            if (line.startsWith("event: ")) {
                                currentEventType = line.removePrefix("event: ")
                            } else if (line.startsWith("data: ")) {
                                dataLines += line.removePrefix("data: ")
                            } else if (line.startsWith(":")) {
                                // keepalive comment, ignore
                            } else if (line.isEmpty() && dataLines.isNotEmpty()) {
                                val payload = dataLines.joinToString(separator = "\n")
                                dataLines.clear()
                                val shouldContinue = emitDecodedPayload(
                                    currentEventType = currentEventType,
                                    payload = payload,
                                    sessionId = sessionId,
                                    runId = runId,
                                    afterCursor = afterCursor,
                                    emitEvent = emitEvent
                                )
                                currentEventType = null
                                if (shouldContinue.not()) {
                                    return
                                }
                            }
                            line = reader.readLine()
                        }
                    }

                    if (dataLines.isNotEmpty()) {
                        val payload = dataLines.joinToString(separator = "\n")
                        val shouldContinue = emitDecodedPayload(
                            currentEventType = currentEventType,
                            payload = payload,
                            sessionId = sessionId,
                            runId = runId,
                            afterCursor = afterCursor,
                            emitEvent = emitEvent
                        )
                        if (shouldContinue.not()) {
                            return
                        }
                    }
                    throw AiChatLiveStreamException(
                        message = "AI live stream ended before a terminal event.",
                        requestId = requestId,
                        code = aiChatLiveStreamEndedBeforeTerminalCode,
                        cause = EOFException("AI live stream ended before a terminal event.")
                    )
                } catch (error: CancellationException) {
                    throw error
                } catch (error: AiChatLiveStreamException) {
                    throw error
                } catch (error: IOException) {
                    throw AiChatLiveStreamException(
                        message = "AI live stream failed while reading the event stream.",
                        requestId = requestId,
                        code = aiChatLiveStreamReadFailedCode,
                        cause = error
                    )
                } catch (error: Exception) {
                    throw AiChatLiveStreamException(
                        message = "AI live stream failed while decoding the event stream.",
                        requestId = requestId,
                        code = "ai_live_stream_decode_failed",
                        cause = error
                    )
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: IOException) {
            if (cancellationRequested.get() || coroutineJob.isCancelled) {
                throw cancellationException(
                    message = "AI live stream request was cancelled.",
                    cause = error
                )
            }
            throw error
        } finally {
            cancellationHandle.dispose()
        }
    }

    private fun readAiChatResponseBody(response: Response): String? {
        return response.body.byteStream().bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
    }

    private fun requireFallbackWorkspaceId(workspaceId: String?): String {
        return requireNotNull(workspaceId?.trim()?.ifEmpty { null }) {
            "AI live attach requires an active workspace when signed Live authorization is unavailable."
        }
    }

    private fun buildLiveUrl(
        liveUrl: String,
        sessionId: String,
        runId: String,
        workspaceId: String?,
        afterCursor: String?
    ): String {
        val queryParameters = mutableListOf(
            "sessionId=${encodeQueryValue(value = sessionId)}",
            "runId=${encodeQueryValue(value = runId)}"
        )
        workspaceId?.let { resolvedWorkspaceId ->
            queryParameters.add("workspaceId=${encodeQueryValue(value = resolvedWorkspaceId)}")
        }
        afterCursor?.let { resolvedAfterCursor ->
            queryParameters.add("afterCursor=${encodeQueryValue(value = resolvedAfterCursor)}")
        }

        return buildString {
            append(liveUrl.removeSuffix("/"))
            append("?")
            append(queryParameters.joinToString(separator = "&"))
        }
    }

    private fun encodeQueryValue(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
    }
}
