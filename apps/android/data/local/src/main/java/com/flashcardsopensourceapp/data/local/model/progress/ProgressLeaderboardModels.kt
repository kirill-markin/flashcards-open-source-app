package com.flashcardsopensourceapp.data.local.model.progress

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState

enum class ProgressLeaderboardWindowKey(
    val wireKey: String,
    // Rolling window length in hours; null for the unbounded all-time window.
    val rollingWindowHours: Int?
) {
    LAST_24_HOURS("last_24_hours", 24),
    LAST_3_DAYS("last_3_days", 72),
    LAST_7_DAYS("last_7_days", 168),
    LAST_30_DAYS("last_30_days", 720),
    ALL_TIME("all_time", null);

    companion object {
        val orderedEntries: List<ProgressLeaderboardWindowKey> = listOf(
            LAST_24_HOURS,
            LAST_3_DAYS,
            LAST_7_DAYS,
            LAST_30_DAYS,
            ALL_TIME
        )

        fun fromWireKey(wireKey: String): ProgressLeaderboardWindowKey {
            return orderedEntries.firstOrNull { key -> key.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard window key '$wireKey'.")
        }
    }
}

enum class ProgressLeaderboardStatus(
    val wireKey: String
) {
    READY("ready"),
    LINKED_ACCOUNT_REQUIRED("linked_account_required"),
    PARTICIPATION_DISABLED("participation_disabled"),
    SNAPSHOT_UNAVAILABLE("snapshot_unavailable");

    companion object {
        fun fromWireKey(wireKey: String): ProgressLeaderboardStatus {
            return entries.firstOrNull { status -> status.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard status '$wireKey'.")
        }
    }
}

enum class ProgressLeaderboardParticipantRowKind(
    val wireKey: String
) {
    TOP("top"),
    NEIGHBOR("neighbor"),
    VIEWER("viewer");

    companion object {
        fun fromWireKey(wireKey: String): ProgressLeaderboardParticipantRowKind {
            return entries.firstOrNull { kind -> kind.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard row kind '$wireKey'.")
        }
    }
}

data class CloudProgressLeaderboardMetric(
    val metricVersion: String,
    val title: String,
    val description: String
)

data class CloudProgressLeaderboardViewer(
    val publicProfileId: String,
    val rank: Int,
    val qualifiedReviewCount: Int
)

sealed interface CloudProgressLeaderboardRow {
    data class Participant(
        val kind: ProgressLeaderboardParticipantRowKind,
        val publicProfileId: String,
        val anonymousDisplayName: String,
        val qualifiedReviewCount: Int,
        val rank: Int
    ) : CloudProgressLeaderboardRow

    data object Gap : CloudProgressLeaderboardRow
}

data class CloudProgressLeaderboardWindow(
    val windowKey: ProgressLeaderboardWindowKey,
    val snapshotId: String,
    val snapshotGeneratedAt: String,
    val asOfServerHour: String,
    val nextRefreshAfter: String,
    val participantCount: Int,
    val viewer: CloudProgressLeaderboardViewer,
    val rows: List<CloudProgressLeaderboardRow>
)

data class CloudProgressLeaderboard(
    val status: ProgressLeaderboardStatus,
    val metric: CloudProgressLeaderboardMetric,
    val defaultWindowKey: ProgressLeaderboardWindowKey,
    val windows: List<CloudProgressLeaderboardWindow>
)

data class ProgressLeaderboardBestPlacement(
    val windowKey: ProgressLeaderboardWindowKey,
    val rank: Int
)

fun resolveBestLeaderboardPlacement(
    leaderboard: CloudProgressLeaderboard?
): ProgressLeaderboardBestPlacement? {
    if (leaderboard == null || leaderboard.status != ProgressLeaderboardStatus.READY) {
        return null
    }

    var bestPlacement: ProgressLeaderboardBestPlacement? = null

    ProgressLeaderboardWindowKey.orderedEntries.forEach { windowKey ->
        val window = leaderboard.windows.firstOrNull { candidate ->
            candidate.windowKey == windowKey
        } ?: return@forEach
        val currentBestPlacement = bestPlacement
        if (currentBestPlacement != null && window.viewer.rank >= currentBestPlacement.rank) {
            return@forEach
        }

        bestPlacement = ProgressLeaderboardBestPlacement(
            windowKey = window.windowKey,
            rank = window.viewer.rank
        )
    }

    return bestPlacement
}

fun resolveBestLeaderboardPlacement(
    snapshot: ProgressLeaderboardSnapshot?
): ProgressLeaderboardBestPlacement? {
    return resolveBestLeaderboardPlacement(leaderboard = snapshot?.leaderboard)
}

data class ProgressLeaderboardScopeKey(
    val scopeId: String
)

data class ProgressLeaderboardSnapshot(
    val scopeKey: ProgressLeaderboardScopeKey,
    val cloudState: CloudAccountState,
    // Last successfully fetched payload for this scope; server ranks stay authoritative.
    val leaderboard: CloudProgressLeaderboard?,
    val payloadUpdatedAtMillis: Long?,
    // Locally computed qualified review counts (rating != again) per rolling window,
    // used only to overlay the viewer row count.
    val viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>,
    // True once the device clock passed the payload's earliest nextRefreshAfter, so a
    // still-rendered cached payload means the refresh could not happen (e.g. offline).
    val isRefreshDue: Boolean,
    val didLastRemoteLoadFail: Boolean
)
