package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal enum class ProgressRefreshReason {
    MISSING_SERVER_BASE,
    LOCAL_CONTEXT_CHANGED,
    SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE,
    MANUAL
}

internal class ProgressBackgroundLauncher(
    private val appScope: CoroutineScope
) {
    // Single entry point for progress appScope launches. It re-throws
    // CancellationException to keep structured concurrency intact, and swallows any
    // other Exception after a structured warning. Errors bubble up to AppGraph's
    // CoroutineExceptionHandler.
    fun launchAndLogFailure(
        event: String,
        fields: List<Pair<String, String?>>,
        block: suspend () -> Unit
    ): Job {
        return appScope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logProgressRepositoryWarning(
                    event = event,
                    fields = fields,
                    error = error
                )
            }
        }
    }
}

internal fun supportsServerRefresh(
    cloudState: CloudAccountState
): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

internal fun createProgressRemoteRefreshSyncMode(
    refreshReason: ProgressRefreshReason
): ProgressRemoteRefreshSyncMode {
    return if (refreshReason == ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE) {
        ProgressRemoteRefreshSyncMode.SKIP_SYNC
    } else {
        ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD
    }
}
