package com.flashcardsopensourceapp.data.local.cloud.wire

import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import org.json.JSONArray
import org.json.JSONObject

internal fun parseCloudProgressLeaderboard(
    payload: JSONObject,
    fieldPath: String
): CloudProgressLeaderboard {
    val status = ProgressLeaderboardStatus.fromWireKey(
        wireKey = payload.requireCloudString("status", "$fieldPath.status")
    )
    val metric = payload.requireCloudObject("metric", "$fieldPath.metric")
    val windowsArray = payload.requireCloudArray("windows", "$fieldPath.windows")
    val windows = buildList {
        for (index in 0 until windowsArray.length()) {
            add(
                windowsArray.requireCloudObject(index, "$fieldPath.windows[$index]")
                    .toCloudProgressLeaderboardWindow(fieldPath = "$fieldPath.windows[$index]")
            )
        }
    }

    return CloudProgressLeaderboard(
        status = status,
        metric = CloudProgressLeaderboardMetric(
            metricVersion = metric.requireCloudString("metricVersion", "$fieldPath.metric.metricVersion"),
            title = metric.requireCloudString("title", "$fieldPath.metric.title"),
            description = metric.requireCloudString("description", "$fieldPath.metric.description")
        ),
        defaultWindowKey = ProgressLeaderboardWindowKey.fromWireKey(
            wireKey = payload.requireCloudString("defaultWindowKey", "$fieldPath.defaultWindowKey")
        ),
        windows = windows
    )
}

private fun JSONObject.toCloudProgressLeaderboardWindow(
    fieldPath: String
): CloudProgressLeaderboardWindow {
    val viewer = requireCloudObject("viewer", "$fieldPath.viewer")
    val rowsArray = requireCloudArray("rows", "$fieldPath.rows")
    val rows = buildList {
        for (index in 0 until rowsArray.length()) {
            add(
                rowsArray.requireCloudObject(index, "$fieldPath.rows[$index]")
                    .toCloudProgressLeaderboardRow(fieldPath = "$fieldPath.rows[$index]")
            )
        }
    }
    val rankingRowsArray = requireCloudArray("rankingRows", "$fieldPath.rankingRows")
    val rankingRows = buildList {
        for (index in 0 until rankingRowsArray.length()) {
            add(
                rankingRowsArray.requireCloudObject(index, "$fieldPath.rankingRows[$index]")
                    .toCloudProgressLeaderboardRankingRow(fieldPath = "$fieldPath.rankingRows[$index]")
            )
        }
    }

    return CloudProgressLeaderboardWindow(
        windowKey = ProgressLeaderboardWindowKey.fromWireKey(
            wireKey = requireCloudString("windowKey", "$fieldPath.windowKey")
        ),
        snapshotId = requireCloudString("snapshotId", "$fieldPath.snapshotId"),
        snapshotGeneratedAt = requireCloudString("snapshotGeneratedAt", "$fieldPath.snapshotGeneratedAt"),
        asOfServerHour = requireCloudString("asOfServerHour", "$fieldPath.asOfServerHour"),
        nextRefreshAfter = requireCloudString("nextRefreshAfter", "$fieldPath.nextRefreshAfter"),
        participantCount = requireCloudNonNegativeInt(
            value = requireCloudInt("participantCount", "$fieldPath.participantCount"),
            fieldPath = "$fieldPath.participantCount"
        ),
        viewer = CloudProgressLeaderboardViewer(
            publicProfileId = viewer.requireCloudString("publicProfileId", "$fieldPath.viewer.publicProfileId"),
            rank = requireCloudPositiveRank(
                value = viewer.requireCloudInt("rank", "$fieldPath.viewer.rank"),
                fieldPath = "$fieldPath.viewer.rank"
            ),
            qualifiedReviewCount = requireCloudNonNegativeInt(
                value = viewer.requireCloudInt("qualifiedReviewCount", "$fieldPath.viewer.qualifiedReviewCount"),
                fieldPath = "$fieldPath.viewer.qualifiedReviewCount"
            )
        ),
        rows = rows,
        rankingRows = rankingRows
    )
}

private fun JSONObject.toCloudProgressLeaderboardRow(
    fieldPath: String
): CloudProgressLeaderboardRow {
    val kind = requireCloudString("kind", "$fieldPath.kind")
    if (kind == "gap") {
        return CloudProgressLeaderboardRow.Gap
    }

    return CloudProgressLeaderboardRow.Participant(
        kind = ProgressLeaderboardParticipantRowKind.fromWireKey(wireKey = kind),
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        anonymousDisplayName = requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
        friendDisplayName = optCloudStringOrNull("friendDisplayName", "$fieldPath.friendDisplayName"),
        qualifiedReviewCount = requireCloudNonNegativeInt(
            value = requireCloudInt("qualifiedReviewCount", "$fieldPath.qualifiedReviewCount"),
            fieldPath = "$fieldPath.qualifiedReviewCount"
        ),
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

private fun JSONObject.toCloudProgressLeaderboardRankingRow(
    fieldPath: String
): CloudProgressLeaderboardRankingRow {
    return CloudProgressLeaderboardRankingRow(
        kind = CloudProgressLeaderboardRankingRowKind.fromWireKey(
            wireKey = requireCloudString("kind", "$fieldPath.kind")
        ),
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        anonymousDisplayName = requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
        friendDisplayName = optCloudStringOrNull("friendDisplayName", "$fieldPath.friendDisplayName"),
        qualifiedReviewCount = requireCloudNonNegativeInt(
            value = requireCloudInt("qualifiedReviewCount", "$fieldPath.qualifiedReviewCount"),
            fieldPath = "$fieldPath.qualifiedReviewCount"
        ),
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

internal fun serializeCloudProgressLeaderboard(
    leaderboard: CloudProgressLeaderboard
): JSONObject {
    return JSONObject()
        .put("status", leaderboard.status.wireKey)
        .put(
            "metric",
            JSONObject()
                .put("metricVersion", leaderboard.metric.metricVersion)
                .put("title", leaderboard.metric.title)
                .put("description", leaderboard.metric.description)
        )
        .put("defaultWindowKey", leaderboard.defaultWindowKey.wireKey)
        .put(
            "windows",
            JSONArray().apply {
                leaderboard.windows.forEach { window ->
                    put(
                        JSONObject()
                            .put("windowKey", window.windowKey.wireKey)
                            .put("snapshotId", window.snapshotId)
                            .put("snapshotGeneratedAt", window.snapshotGeneratedAt)
                            .put("asOfServerHour", window.asOfServerHour)
                            .put("nextRefreshAfter", window.nextRefreshAfter)
                            .put("participantCount", window.participantCount)
                            .put(
                                "viewer",
                                JSONObject()
                                    .put("publicProfileId", window.viewer.publicProfileId)
                                    .put("rank", window.viewer.rank)
                                    .put("qualifiedReviewCount", window.viewer.qualifiedReviewCount)
                            )
                            .put(
                                "rows",
                                JSONArray().apply {
                                    window.rows.forEach { row ->
                                        put(row.toJson())
                                    }
                                }
                            )
                            .put(
                                "rankingRows",
                                JSONArray().apply {
                                    window.rankingRows.forEach { row ->
                                        put(row.toJson())
                                    }
                                }
                            )
                    )
                }
            }
        )
}

private fun CloudProgressLeaderboardRow.toJson(): JSONObject {
    return when (this) {
        is CloudProgressLeaderboardRow.Gap -> JSONObject().put("kind", "gap")
        is CloudProgressLeaderboardRow.Participant -> JSONObject()
            .put("kind", kind.wireKey)
            .put("publicProfileId", publicProfileId)
            .put("anonymousDisplayName", anonymousDisplayName)
            .putOptionalCloudString(name = "friendDisplayName", value = friendDisplayName)
            .put("qualifiedReviewCount", qualifiedReviewCount)
            .put("rank", rank)
    }
}

private fun CloudProgressLeaderboardRankingRow.toJson(): JSONObject {
    return JSONObject()
        .put("kind", kind.wireKey)
        .put("publicProfileId", publicProfileId)
        .put("anonymousDisplayName", anonymousDisplayName)
        .putOptionalCloudString(name = "friendDisplayName", value = friendDisplayName)
        .put("qualifiedReviewCount", qualifiedReviewCount)
        .put("rank", rank)
}

internal fun parseCloudProgressStreakLeaderboard(
    payload: JSONObject,
    fieldPath: String
): CloudProgressStreakLeaderboard {
    val status = ProgressLeaderboardStatus.fromWireKey(
        wireKey = payload.requireCloudString("status", "$fieldPath.status")
    )
    val metric = payload.requireCloudObject("metric", "$fieldPath.metric")
        .toCloudProgressStreakLeaderboardMetric(fieldPath = "$fieldPath.metric")
    if (status != ProgressLeaderboardStatus.READY) {
        return CloudProgressStreakLeaderboard.NonReady(
            status = status,
            metric = metric
        )
    }

    val viewer = payload.requireCloudObject("viewer", "$fieldPath.viewer")
        .toCloudProgressStreakLeaderboardViewer(fieldPath = "$fieldPath.viewer")
    val rowsArray = payload.requireCloudArray("rows", "$fieldPath.rows")
    val rows = buildList {
        for (index in 0 until rowsArray.length()) {
            add(
                rowsArray.requireCloudObject(index, "$fieldPath.rows[$index]")
                    .toCloudProgressStreakLeaderboardRow(fieldPath = "$fieldPath.rows[$index]")
            )
        }
    }
    val rankingRowsArray = payload.requireCloudArray("rankingRows", "$fieldPath.rankingRows")
    val rankingRows = buildList {
        for (index in 0 until rankingRowsArray.length()) {
            add(
                rankingRowsArray.requireCloudObject(index, "$fieldPath.rankingRows[$index]")
                    .toCloudProgressStreakLeaderboardRankingRow(fieldPath = "$fieldPath.rankingRows[$index]")
            )
        }
    }
    val asOfUtcDate = payload.requireCloudString("asOfUtcDate", "$fieldPath.asOfUtcDate")
    parseCloudLocalDate(
        value = asOfUtcDate,
        fieldPath = "$fieldPath.asOfUtcDate"
    )
    validateCloudProgressStreakLeaderboardReadyPayload(
        fieldPath = fieldPath,
        participantCount = requireCloudNonNegativeInt(
            value = payload.requireCloudInt("participantCount", "$fieldPath.participantCount"),
            fieldPath = "$fieldPath.participantCount"
        ),
        viewer = viewer,
        rankingRows = rankingRows
    )

    return CloudProgressStreakLeaderboard.Ready(
        status = status,
        metric = metric,
        snapshotId = payload.requireCloudString("snapshotId", "$fieldPath.snapshotId"),
        snapshotGeneratedAt = payload.requireCloudString("snapshotGeneratedAt", "$fieldPath.snapshotGeneratedAt"),
        asOfUtcDate = asOfUtcDate,
        nextRefreshAfter = payload.requireCloudString("nextRefreshAfter", "$fieldPath.nextRefreshAfter"),
        participantCount = rankingRows.size,
        viewer = viewer,
        rows = rows,
        rankingRows = rankingRows
    )
}

private fun JSONObject.toCloudProgressStreakLeaderboardMetric(
    fieldPath: String
): CloudProgressStreakLeaderboardMetric {
    val metricVersion = requireCloudString("metricVersion", "$fieldPath.metricVersion")
    if (metricVersion != "streak_days_v1") {
        throw CloudContractMismatchException(
            "$fieldPath.metricVersion expected 'streak_days_v1' but got '$metricVersion'."
        )
    }

    return CloudProgressStreakLeaderboardMetric(
        metricVersion = metricVersion,
        title = requireCloudString("title", "$fieldPath.title"),
        description = requireCloudString("description", "$fieldPath.description")
    )
}

private fun JSONObject.toCloudProgressStreakLeaderboardViewer(
    fieldPath: String
): CloudProgressStreakLeaderboardViewer {
    val displayName = requireCloudString("displayName", "$fieldPath.displayName")
    if (displayName != "You") {
        throw CloudContractMismatchException("$fieldPath.displayName expected 'You' but got '$displayName'.")
    }

    return CloudProgressStreakLeaderboardViewer(
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        displayName = displayName,
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        ),
        streakDays = requireCloudNonNegativeInt(
            value = requireCloudInt("streakDays", "$fieldPath.streakDays"),
            fieldPath = "$fieldPath.streakDays"
        )
    )
}

private fun JSONObject.toCloudProgressStreakLeaderboardRow(
    fieldPath: String
): CloudProgressStreakLeaderboardRow {
    val kind = requireCloudString("kind", "$fieldPath.kind")
    if (kind == "gap") {
        return CloudProgressStreakLeaderboardRow.Gap
    }

    return CloudProgressStreakLeaderboardRow.Participant(
        kind = ProgressLeaderboardParticipantRowKind.fromWireKey(wireKey = kind),
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        anonymousDisplayName = requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
        friendDisplayName = optCloudStringOrNull("friendDisplayName", "$fieldPath.friendDisplayName"),
        streakDays = requireCloudNonNegativeInt(
            value = requireCloudInt("streakDays", "$fieldPath.streakDays"),
            fieldPath = "$fieldPath.streakDays"
        ),
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

private fun JSONObject.toCloudProgressStreakLeaderboardRankingRow(
    fieldPath: String
): CloudProgressStreakLeaderboardRankingRow {
    return CloudProgressStreakLeaderboardRankingRow(
        kind = CloudProgressLeaderboardRankingRowKind.fromWireKey(
            wireKey = requireCloudString("kind", "$fieldPath.kind")
        ),
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        anonymousDisplayName = requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
        friendDisplayName = optCloudStringOrNull("friendDisplayName", "$fieldPath.friendDisplayName"),
        streakDays = requireCloudNonNegativeInt(
            value = requireCloudInt("streakDays", "$fieldPath.streakDays"),
            fieldPath = "$fieldPath.streakDays"
        ),
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

private fun validateCloudProgressStreakLeaderboardReadyPayload(
    fieldPath: String,
    participantCount: Int,
    viewer: CloudProgressStreakLeaderboardViewer,
    rankingRows: List<CloudProgressStreakLeaderboardRankingRow>
) {
    if (participantCount != rankingRows.size) {
        throw CloudContractMismatchException(
            "$fieldPath.participantCount expected rankingRows size ${rankingRows.size} but got $participantCount."
        )
    }
    val viewerRows = rankingRows.filter { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }
    if (viewerRows.size != 1) {
        throw CloudContractMismatchException("$fieldPath.rankingRows must include exactly one viewer row.")
    }
    val viewerRow = viewerRows.single()
    if (
        viewerRow.publicProfileId != viewer.publicProfileId ||
        viewerRow.rank != viewer.rank ||
        viewerRow.streakDays != viewer.streakDays
    ) {
        throw CloudContractMismatchException("$fieldPath.viewer must match the rankingRows viewer row.")
    }

    var previousStreakDays: Int? = null
    rankingRows.forEachIndexed { index, row ->
        val expectedRank = index + 1
        if (row.rank != expectedRank) {
            throw CloudContractMismatchException(
                "$fieldPath.rankingRows[$index].rank expected $expectedRank but got ${row.rank}."
            )
        }
        val resolvedPreviousStreakDays = previousStreakDays
        if (resolvedPreviousStreakDays != null && row.streakDays > resolvedPreviousStreakDays) {
            throw CloudContractMismatchException(
                "$fieldPath.rankingRows[$index].streakDays must not be greater than the previous ranked row."
            )
        }
        previousStreakDays = row.streakDays
    }
}

internal fun serializeCloudProgressStreakLeaderboard(
    leaderboard: CloudProgressStreakLeaderboard
): JSONObject {
    val baseJson = JSONObject()
        .put("status", leaderboard.status.wireKey)
        .put(
            "metric",
            JSONObject()
                .put("metricVersion", leaderboard.metric.metricVersion)
                .put("title", leaderboard.metric.title)
                .put("description", leaderboard.metric.description)
        )

    return when (leaderboard) {
        is CloudProgressStreakLeaderboard.NonReady -> baseJson
        is CloudProgressStreakLeaderboard.Ready -> baseJson
            .put("snapshotId", leaderboard.snapshotId)
            .put("snapshotGeneratedAt", leaderboard.snapshotGeneratedAt)
            .put("asOfUtcDate", leaderboard.asOfUtcDate)
            .put("nextRefreshAfter", leaderboard.nextRefreshAfter)
            .put("participantCount", leaderboard.participantCount)
            .put(
                "viewer",
                JSONObject()
                    .put("publicProfileId", leaderboard.viewer.publicProfileId)
                    .put("displayName", leaderboard.viewer.displayName)
                    .put("rank", leaderboard.viewer.rank)
                    .put("streakDays", leaderboard.viewer.streakDays)
            )
            .put(
                "rows",
                JSONArray().apply {
                    leaderboard.rows.forEach { row ->
                        put(row.toJson())
                    }
                }
            )
            .put(
                "rankingRows",
                JSONArray().apply {
                    leaderboard.rankingRows.forEach { row ->
                        put(row.toJson())
                    }
                }
            )
    }
}

private fun CloudProgressStreakLeaderboardRow.toJson(): JSONObject {
    return when (this) {
        is CloudProgressStreakLeaderboardRow.Gap -> JSONObject().put("kind", "gap")
        is CloudProgressStreakLeaderboardRow.Participant -> JSONObject()
            .put("kind", kind.wireKey)
            .put("publicProfileId", publicProfileId)
            .put("anonymousDisplayName", anonymousDisplayName)
            .putOptionalCloudString(name = "friendDisplayName", value = friendDisplayName)
            .put("streakDays", streakDays)
            .put("rank", rank)
    }
}

private fun CloudProgressStreakLeaderboardRankingRow.toJson(): JSONObject {
    return JSONObject()
        .put("kind", kind.wireKey)
        .put("publicProfileId", publicProfileId)
        .put("anonymousDisplayName", anonymousDisplayName)
        .putOptionalCloudString(name = "friendDisplayName", value = friendDisplayName)
        .put("streakDays", streakDays)
        .put("rank", rank)
}

private fun JSONObject.putOptionalCloudString(name: String, value: String?): JSONObject {
    if (value != null) {
        put(name, value)
    }
    return this
}
