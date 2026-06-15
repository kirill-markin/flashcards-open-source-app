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

enum class CloudProgressLeaderboardRankingRowKind(
    val wireKey: String
) {
    PARTICIPANT("participant"),
    VIEWER("viewer");

    companion object {
        fun fromWireKey(wireKey: String): CloudProgressLeaderboardRankingRowKind {
            return entries.firstOrNull { kind -> kind.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard ranking row kind '$wireKey'.")
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
        val friendDisplayName: String?,
        val qualifiedReviewCount: Int,
        val rank: Int
    ) : CloudProgressLeaderboardRow

    data object Gap : CloudProgressLeaderboardRow
}

data class CloudProgressLeaderboardRankingRow(
    val kind: CloudProgressLeaderboardRankingRowKind,
    val publicProfileId: String,
    val anonymousDisplayName: String,
    val friendDisplayName: String?,
    val qualifiedReviewCount: Int,
    val rank: Int
)

data class CloudProgressLeaderboardWindow(
    val windowKey: ProgressLeaderboardWindowKey,
    val snapshotId: String,
    val snapshotGeneratedAt: String,
    val asOfServerHour: String,
    val nextRefreshAfter: String,
    val participantCount: Int,
    val viewer: CloudProgressLeaderboardViewer,
    val rows: List<CloudProgressLeaderboardRow>,
    val rankingRows: List<CloudProgressLeaderboardRankingRow>
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
    return resolveBestLeaderboardPlacement(leaderboard = snapshot?.renderedLeaderboard)
}

data class ProgressLeaderboardScopeKey(
    val scopeId: String
)

data class ProgressLeaderboardSnapshot(
    val scopeKey: ProgressLeaderboardScopeKey,
    val cloudState: CloudAccountState,
    // Last successfully fetched payload for this scope.
    val leaderboard: CloudProgressLeaderboard?,
    // Server payload projected with locally observed viewer reviews for display.
    val renderedLeaderboard: CloudProgressLeaderboard?,
    val payloadUpdatedAtMillis: Long?,
    // Locally computed qualified review counts (rating != again) per rolling window,
    // used to project only the current viewer row.
    val viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>,
    // True once the device clock passed the payload's earliest nextRefreshAfter, so a
    // still-rendered cached payload means the refresh could not happen (e.g. offline).
    val isRefreshDue: Boolean,
    val didLastRemoteLoadFail: Boolean
)

fun createRenderedProgressLeaderboard(
    leaderboard: CloudProgressLeaderboard?,
    viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>
): CloudProgressLeaderboard? {
    if (leaderboard == null || leaderboard.status != ProgressLeaderboardStatus.READY) {
        return leaderboard
    }

    return leaderboard.copy(
        windows = leaderboard.windows.map { window ->
            window.toRenderedProgressLeaderboardWindow(
                viewerLocalQualifiedCounts = viewerLocalQualifiedCounts
            )
        }
    )
}

private fun CloudProgressLeaderboardWindow.toRenderedProgressLeaderboardWindow(
    viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>
): CloudProgressLeaderboardWindow {
    val viewerRankingRow = requireNotNull(
        rankingRows.firstOrNull { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }
    ) {
        "Leaderboard rankingRows for window '${windowKey.wireKey}' must include viewer '${viewer.publicProfileId}'."
    }
    val viewerCount = maxOf(
        viewer.qualifiedReviewCount,
        viewerLocalQualifiedCounts[windowKey] ?: 0
    )
    val participantRows = rankingRows.filter { row ->
        row.kind != CloudProgressLeaderboardRankingRowKind.VIEWER
    }
    val viewerInsertionIndex = participantRows.indexOfFirst { row ->
        row.qualifiedReviewCount < viewerCount
    }.let { index ->
        if (index == -1) {
            participantRows.size
        } else {
            index
        }
    }
    val unrankedRows = participantRows.toMutableList().apply {
        add(
            viewerInsertionIndex,
            viewerRankingRow.copy(qualifiedReviewCount = viewerCount)
        )
    }
    val projectedRankingRows = unrankedRows.mapIndexed { index, row ->
        row.copy(rank = index + 1)
    }
    val projectedViewer = requireNotNull(
        projectedRankingRows.firstOrNull { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }
    ) {
        "Projected leaderboard rankingRows for window '${windowKey.wireKey}' must include viewer '${viewer.publicProfileId}'."
    }

    return copy(
        viewer = viewer.copy(
            rank = projectedViewer.rank,
            qualifiedReviewCount = projectedViewer.qualifiedReviewCount
        ),
        rows = buildProgressLeaderboardCompactRows(rankingRows = projectedRankingRows),
        rankingRows = projectedRankingRows
    )
}

private fun buildProgressLeaderboardCompactRows(
    rankingRows: List<CloudProgressLeaderboardRankingRow>
): List<CloudProgressLeaderboardRow> {
    val totalRowCount = rankingRows.size
    val topRowCount = minOf(3, totalRowCount)
    val viewerRank = requireNotNull(
        rankingRows.firstOrNull { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }?.rank
    ) {
        "Projected leaderboard rankingRows must include a viewer row."
    }
    val shownRanks = mutableSetOf<Int>()
    (1..topRowCount).forEach { rank ->
        shownRanks.add(rank)
    }
    if (viewerRank > topRowCount) {
        listOf(viewerRank - 1, viewerRank, viewerRank + 1).forEach { rank ->
            if (rank >= 1 && rank <= totalRowCount) {
                shownRanks.add(rank)
            }
        }
    } else if (viewerRank == topRowCount && viewerRank < totalRowCount) {
        shownRanks.add(viewerRank + 1)
    }
    if (totalRowCount > topRowCount) {
        shownRanks.add(totalRowCount)
    }
    rankingRows.forEach { row ->
        if (row.friendDisplayName != null) {
            shownRanks.add(row.rank)
        }
    }

    val rowsByRank = rankingRows.associateBy { row -> row.rank }
    return buildList {
        var previousRank = 0
        shownRanks.sorted().forEach { rank ->
            if (previousRank != 0 && rank > previousRank + 1) {
                add(CloudProgressLeaderboardRow.Gap)
            }

            val rankingRow = requireNotNull(rowsByRank[rank]) {
                "Projected leaderboard rankingRows must include rank $rank."
            }
            add(rankingRow.toCompactProgressLeaderboardRow(topRowCount = topRowCount))
            previousRank = rank
        }
    }
}

private fun CloudProgressLeaderboardRankingRow.toCompactProgressLeaderboardRow(
    topRowCount: Int
): CloudProgressLeaderboardRow.Participant {
    return CloudProgressLeaderboardRow.Participant(
        kind = when {
            kind == CloudProgressLeaderboardRankingRowKind.VIEWER -> ProgressLeaderboardParticipantRowKind.VIEWER
            rank <= topRowCount -> ProgressLeaderboardParticipantRowKind.TOP
            else -> ProgressLeaderboardParticipantRowKind.NEIGHBOR
        },
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        friendDisplayName = friendDisplayName,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}
