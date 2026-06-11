package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.progressHistoryDayCount
import java.time.LocalDate
import java.time.ZoneId

internal fun createProgressSummaryScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSummaryScopeKey {
    return ProgressSummaryScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        referenceLocalDate = today.toString()
    )
}

internal fun createProgressSeriesScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSeriesScopeKey {
    val from = today.minusDays(progressHistoryDayCount - 1L)
    return ProgressSeriesScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        from = from.toString(),
        to = today.toString()
    )
}

internal fun createProgressReviewScheduleScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId,
    workspaceIds: List<String>
): ProgressReviewScheduleScopeKey {
    return ProgressReviewScheduleScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        workspaceMembershipKey = createProgressWorkspaceMembershipKey(workspaceIds = workspaceIds),
        referenceLocalDate = today.toString()
    )
}

// The leaderboard payload is account-scoped: ranks cover the whole account regardless
// of time zone or local date, so the scope id alone identifies the cached payload.
internal fun createProgressLeaderboardScopeKey(
    cloudSettings: CloudSettings
): ProgressLeaderboardScopeKey {
    return ProgressLeaderboardScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings)
    )
}

internal fun createProgressScopeId(
    cloudSettings: CloudSettings
): String {
    return when (cloudSettings.cloudState) {
        CloudAccountState.LINKED -> "linked:${cloudSettings.linkedUserId ?: cloudSettings.installationId}"
        CloudAccountState.GUEST -> "guest:${cloudSettings.activeWorkspaceId ?: cloudSettings.installationId}"
        CloudAccountState.DISCONNECTED -> "local:${cloudSettings.installationId}"
        CloudAccountState.LINKING_READY -> "linking:${cloudSettings.installationId}"
    }
}

internal fun createProgressWorkspaceMembershipKey(
    workspaceIds: List<String>
): String {
    return workspaceIds.distinct().sorted().joinToString(separator = "|")
}

internal fun serializeProgressSummaryScopeKey(
    scopeKey: ProgressSummaryScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.referenceLocalDate}"
}

internal fun serializeProgressSeriesScopeKey(
    scopeKey: ProgressSeriesScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.from}::${scopeKey.to}"
}

internal fun serializeProgressReviewScheduleScopeKey(
    scopeKey: ProgressReviewScheduleScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::" +
        "${scopeKey.workspaceMembershipKey}::${scopeKey.referenceLocalDate}"
}

internal fun serializeProgressReviewScheduleServerCacheKey(
    scopeKey: ProgressReviewScheduleScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.referenceLocalDate}"
}
