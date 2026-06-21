package com.flashcardsopensourceapp.data.local.repository.progress.runtime

import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.network.isRetryableHttpStatusCode
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressReviewScheduleStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSeriesStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSummaryStoreState
import java.io.IOException
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

internal data class ProgressObservationVersions(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

internal class ProgressBackgroundLauncher(
    private val appScope: CoroutineScope,
    private val observability: AppObservability,
    private val observationVersions: ProgressObservationVersions
) {
    // Single entry point for progress appScope launches. It re-throws CancellationException
    // to keep structured concurrency intact and swallows any other Exception after local
    // Logcat visibility plus a structured exception event.
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
                val scopeId = extractProgressScopeId(fields = fields)
                observability.captureException(
                    event = AndroidExceptionIssueEvent.ProgressRepositoryException(
                        throwable = error,
                        workspaceId = extractProgressWorkspaceId(
                            fields = fields,
                            scopeId = scopeId
                        ),
                        repositoryAction = event,
                        scopeId = scopeId,
                        source = "progress_background_launcher",
                        appVersion = observationVersions.appVersion,
                        clientVersion = observationVersions.clientVersion,
                        versionCode = observationVersions.versionCode
                    )
                )
            }
        }
    }
}

internal fun createProgressObservationVersions(
    appVersion: String,
    versionCode: Int
): ProgressObservationVersions {
    val resolvedAppVersion = appVersion.trim().takeIf { value -> value.isNotEmpty() }
    return ProgressObservationVersions(
        appVersion = resolvedAppVersion,
        clientVersion = resolvedAppVersion,
        versionCode = versionCode
    )
}

internal fun logProgressRefreshWarning(
    observability: AppObservability,
    observationVersions: ProgressObservationVersions,
    event: String,
    scopeId: String,
    source: String,
    fields: List<Pair<String, String?>>,
    error: Throwable
): Unit {
    observability.captureWarning(
        event = AndroidWarningIssueEvent.ProgressRefreshWarning(
            workspaceId = extractProgressWorkspaceId(
                fields = fields,
                scopeId = scopeId
            ),
            refreshAction = event,
            scopeId = scopeId,
            source = source,
            appVersion = observationVersions.appVersion,
            clientVersion = observationVersions.clientVersion,
            versionCode = observationVersions.versionCode
        )
    )
    logProgressRepositoryWarning(
        event = event,
        fields = fields,
        error = error
    )
}

internal fun logProgressSyncBeforeRemoteLoadFailure(
    observability: AppObservability,
    observationVersions: ProgressObservationVersions,
    event: String,
    scopeId: String,
    source: String,
    fields: List<Pair<String, String?>>,
    error: Throwable
): Unit {
    if (isExpectedTransientProgressRefreshError(error = error)) {
        logProgressRepositoryWarning(
            event = event,
            fields = fields + listOf(
                "sentryWarningSuppressed" to "true",
                "suppressionReason" to "transient_sync_before_remote_load_failure"
            ),
            error = error
        )
        return
    }

    logProgressRefreshWarning(
        observability = observability,
        observationVersions = observationVersions,
        event = event,
        scopeId = scopeId,
        source = source,
        fields = fields,
        error = error
    )
}

internal fun logProgressRemoteLoadFailure(
    observability: AppObservability,
    observationVersions: ProgressObservationVersions,
    event: String,
    scopeId: String,
    source: String,
    fields: List<Pair<String, String?>>,
    error: Throwable
): Unit {
    if (isExpectedTransientProgressRefreshError(error = error)) {
        logProgressRepositoryWarning(
            event = event,
            fields = fields + listOf(
                "sentryWarningSuppressed" to "true",
                "suppressionReason" to "transient_remote_load_failure"
            ),
            error = error
        )
        return
    }

    logProgressRefreshWarning(
        observability = observability,
        observationVersions = observationVersions,
        event = event,
        scopeId = scopeId,
        source = source,
        fields = fields,
        error = error
    )
}

internal fun isExpectedTransientProgressRefreshError(error: Throwable): Boolean {
    var currentError: Throwable? = error
    while (currentError != null) {
        if (
            currentError is CloudRemoteException &&
            isRetryableHttpStatusCode(statusCode = currentError.statusCode)
        ) {
            return true
        }
        if (
            currentError is IOException &&
            isLikelyTransientNetworkIoException(error = currentError)
        ) {
            return true
        }
        currentError = currentError.cause
    }

    return false
}

internal fun supportsServerRefresh(
    cloudState: CloudAccountState
): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

internal fun shouldSuppressProgressSummaryRemoteLoadWarning(
    latestStoreState: ProgressSummaryStoreState?,
    refreshStoreState: ProgressSummaryStoreState
): Boolean {
    if (latestStoreState == null) {
        return true
    }
    if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
        return true
    }
    if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
        return true
    }

    return latestStoreState.isLocalCacheReady.not()
}

internal fun shouldSuppressProgressSeriesRemoteLoadWarning(
    latestStoreState: ProgressSeriesStoreState?,
    refreshStoreState: ProgressSeriesStoreState
): Boolean {
    if (latestStoreState == null) {
        return true
    }
    if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
        return true
    }
    if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
        return true
    }

    return latestStoreState.isLocalCacheReady.not()
}

internal fun shouldSuppressProgressReviewScheduleRemoteLoadWarning(
    latestStoreState: ProgressReviewScheduleStoreState?,
    refreshStoreState: ProgressReviewScheduleStoreState
): Boolean {
    if (latestStoreState == null) {
        return true
    }
    if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
        return true
    }

    return supportsServerRefresh(cloudState = latestStoreState.cloudState).not()
}

private fun extractProgressWorkspaceId(
    fields: List<Pair<String, String?>>,
    scopeId: String?
): String? {
    val explicitWorkspaceId = progressFieldValue(
        fields = fields,
        fieldName = "workspaceId"
    )
    if (explicitWorkspaceId != null) {
        return explicitWorkspaceId
    }

    val fieldScopeId = progressFieldValue(
        fields = fields,
        fieldName = "scopeId"
    )
    val fieldScopeKey = progressFieldValue(
        fields = fields,
        fieldName = "scopeKey"
    )
    return extractProgressWorkspaceIdFromScopeId(scopeId = scopeId)
        ?: extractProgressWorkspaceIdFromScopeId(scopeId = fieldScopeId)
        ?: extractProgressWorkspaceIdFromScopeKey(scopeKey = fieldScopeKey)
}

private fun extractProgressScopeId(fields: List<Pair<String, String?>>): String? {
    val explicitScopeId = progressFieldValue(
        fields = fields,
        fieldName = "scopeId"
    )
    if (explicitScopeId != null) {
        return explicitScopeId
    }

    val scopeKey = progressFieldValue(
        fields = fields,
        fieldName = "scopeKey"
    )
    return extractProgressScopeIdFromScopeKey(scopeKey = scopeKey)
}

private fun extractProgressWorkspaceIdFromScopeKey(scopeKey: String?): String? {
    val scopeId = extractProgressScopeIdFromScopeKey(scopeKey = scopeKey)
    return extractProgressWorkspaceIdFromScopeId(scopeId = scopeId)
}

private fun extractProgressScopeIdFromScopeKey(scopeKey: String?): String? {
    if (scopeKey == null) {
        return null
    }

    return scopeKey.substringBefore(delimiter = "::", missingDelimiterValue = scopeKey)
}

private fun extractProgressWorkspaceIdFromScopeId(scopeId: String?): String? {
    if (scopeId == null) {
        return null
    }

    val guestPrefix = "guest:"
    if (scopeId.startsWith(prefix = guestPrefix).not()) {
        return null
    }

    return scopeId.removePrefix(prefix = guestPrefix).ifBlank { null }
}

private fun progressFieldValue(
    fields: List<Pair<String, String?>>,
    fieldName: String
): String? {
    return fields.firstOrNull { field -> field.first == fieldName }?.second
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
