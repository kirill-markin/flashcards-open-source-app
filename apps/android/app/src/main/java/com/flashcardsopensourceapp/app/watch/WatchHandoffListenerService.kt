package com.flashcardsopensourceapp.app.watch

import android.util.Log
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.shouldCaptureAndroidThrowable
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffReplyResult
import com.flashcardsopensourceapp.data.local.watch.decodeWatchHandoffRequest
import com.flashcardsopensourceapp.data.local.watch.encodeWatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.makeWatchHandoffFailureReply
import com.flashcardsopensourceapp.data.local.watch.watchHandoffRpcPath
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.TaskCompletionSource
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.WearableListenerService
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val watchHandoffLogTag: String = "WatchHandoff"

/** Answers the watch's sign-in handoff request; it never messages the watch on its own. */
class WatchHandoffListenerService : WearableListenerService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onRequest(nodeId: String, path: String, request: ByteArray): Task<ByteArray> {
        val appGraph = (application as FlashcardsApplication).appGraphOrNull
        if (appGraph == null) {
            Log.w(watchHandoffLogTag, "event=watch_handoff_failure stage=app_graph_unavailable")
            return Tasks.forResult(makeWatchHandoffFailureReply())
        }

        val reply = TaskCompletionSource<ByteArray>()
        serviceScope.launch {
            try {
                reply.setResult(buildReplyPayload(appGraph = appGraph, path = path, request = request))
            } finally {
                // A cancelled build still answers, so the watch fails at once instead of timing out.
                reply.trySetResult(makeWatchHandoffFailureReply())
            }
        }
        return reply.task
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }
}

private suspend fun buildReplyPayload(appGraph: AppGraph, path: String, request: ByteArray): ByteArray {
    try {
        require(path == watchHandoffRpcPath) {
            "Watch handoff request arrived on path \"$path\"; expected \"$watchHandoffRpcPath\""
        }
        decodeWatchHandoffRequest(payload = request)
    } catch (error: Exception) {
        recordWatchHandoffFailure(appGraph = appGraph, stage = "decode_request", error = error, isAlreadyReported = false)
        return makeWatchHandoffFailureReply()
    }

    try {
        appGraph.awaitStartup()
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        recordWatchHandoffFailure(appGraph = appGraph, stage = "app_startup", error = error, isAlreadyReported = true)
        return makeWatchHandoffFailureReply()
    }

    val result: WatchHandoffReplyResult
    val payload: ByteArray
    try {
        result = appGraph.watchHandoffReplyBuilder.buildReply()
        payload = encodeWatchHandoffReply(reply = result.reply)
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        recordWatchHandoffFailure(appGraph = appGraph, stage = "build_reply", error = error, isAlreadyReported = false)
        return makeWatchHandoffFailureReply()
    }

    appGraph.observability.addBreadcrumb(
        event = AndroidBreadcrumbEvent.WatchHandoffReplied(
            reason = result.reason.wireValue,
            workspaceId = result.workspaceId,
            appVersion = appGraph.appPackageInfo.versionName,
            clientVersion = appGraph.appPackageInfo.versionName,
            versionCode = appGraph.appPackageInfo.longVersionCode.toInt()
        )
    )
    return payload
}

private fun recordWatchHandoffFailure(
    appGraph: AppGraph,
    stage: String,
    error: Exception,
    isAlreadyReported: Boolean
) {
    // Startup already reported its own failure, an offline phone fails every watch request the same way, and
    // the HTTP layer reports what it already observed; none is worth another issue.
    if (
        isAlreadyReported ||
        isTransientNetworkTransportFailure(error = error) ||
        shouldCaptureAndroidThrowable(throwable = error).not()
    ) {
        Log.w(
            watchHandoffLogTag,
            "event=watch_handoff_failure stage=$stage ${renderSanitizedThrowableLogFields(error = error)}"
        )
        appGraph.observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.WatchHandoffFailed(
                stage = stage,
                errorClass = error::class.java.name,
                errorMessage = error.message,
                appVersion = appGraph.appPackageInfo.versionName,
                clientVersion = appGraph.appPackageInfo.versionName,
                versionCode = appGraph.appPackageInfo.longVersionCode.toInt()
            )
        )
        return
    }
    // captureException logs the sanitized throwable to logcat as well.
    appGraph.observability.captureException(
        event = AndroidExceptionIssueEvent.WatchHandoffException(
            throwable = error,
            stage = stage,
            appVersion = appGraph.appPackageInfo.versionName,
            clientVersion = appGraph.appPackageInfo.versionName,
            versionCode = appGraph.appPackageInfo.longVersionCode.toInt()
        )
    )
}

private fun isTransientNetworkTransportFailure(error: Throwable): Boolean {
    return generateSequence(seed = error) { currentError: Throwable -> currentError.cause }
        .any { currentError: Throwable ->
            currentError is IOException && isLikelyTransientNetworkIoException(error = currentError)
        }
}
