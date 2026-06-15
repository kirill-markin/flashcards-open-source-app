package com.flashcardsopensourceapp.data.local.cloud.remote.progress

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressLeaderboardCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressReviewScheduleCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressSeriesCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressSummaryCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import org.json.JSONObject

internal class CloudProgressRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressSummaryCloudPath(timeZone = timeZone),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )
    }

    suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressSeriesCloudPath(
                timeZone = timeZone,
                from = from,
                to = to
            ),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressSeriesResponse(
            response = response,
            fieldPath = "progress"
        )
    }

    suspend fun loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressReviewSchedule {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressReviewScheduleCloudPath(timeZone = timeZone),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressReviewScheduleResponse(
            response = response,
            fieldPath = "progress.reviewSchedule"
        )
    }

    suspend fun loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressLeaderboard {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressLeaderboardCloudPath(),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressLeaderboard(
            payload = response,
            fieldPath = "progress.leaderboard"
        )
    }
}

internal fun parseCloudProgressSummaryResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressSummary {
    val reviewHistoryWatermarks = response.requireProgressReviewHistoryWatermarks(
        fieldPath = fieldPath
    )
    return response.requireCloudObject("summary", "$fieldPath.summary").toCloudProgressSummary(
        fieldPath = "$fieldPath.summary",
        reviewHistoryWatermarks = reviewHistoryWatermarks
    )
}

internal fun parseCloudProgressSeriesResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressSeries {
    val dailyReviews = response.requireCloudArray("dailyReviews", "$fieldPath.dailyReviews")

    return CloudProgressSeries(
        timeZone = response.requireCloudString("timeZone", "$fieldPath.timeZone"),
        from = response.requireCloudString("from", "$fieldPath.from"),
        to = response.requireCloudString("to", "$fieldPath.to"),
        dailyReviews = buildList {
            for (index in 0 until dailyReviews.length()) {
                val point = dailyReviews.requireCloudObject(index, "$fieldPath.dailyReviews[$index]")
                add(
                    CloudDailyReviewPoint(
                        date = point.requireCloudString("date", "$fieldPath.dailyReviews[$index].date"),
                        reviewCount = point.requireCloudInt(
                            "reviewCount",
                            "$fieldPath.dailyReviews[$index].reviewCount"
                        )
                    )
                )
            }
        },
        generatedAt = response.optCloudStringOrNull("generatedAt", "$fieldPath.generatedAt"),
        reviewHistoryWatermarks = response.requireProgressReviewHistoryWatermarks(
            fieldPath = fieldPath
        ),
        summary = null
    )
}

private fun JSONObject.toCloudProgressSummary(
    fieldPath: String,
    reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>
): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = requireCloudInt("currentStreakDays", "$fieldPath.currentStreakDays"),
        hasReviewedToday = requireCloudBoolean("hasReviewedToday", "$fieldPath.hasReviewedToday"),
        lastReviewedOn = requireCloudNullableString("lastReviewedOn", "$fieldPath.lastReviewedOn"),
        activeReviewDays = requireCloudInt("activeReviewDays", "$fieldPath.activeReviewDays"),
        reviewHistoryWatermarks = reviewHistoryWatermarks
    )
}

internal fun parseCloudProgressReviewScheduleResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressReviewSchedule {
    val bucketsArray = response.requireCloudArray("buckets", "$fieldPath.buckets")
    val buckets = buildList {
        for (index in 0 until bucketsArray.length()) {
            val bucket = bucketsArray.requireCloudObject(index, "$fieldPath.buckets[$index]")
            val expectedBucketKey = ProgressReviewScheduleBucketKey.orderedEntries.getOrNull(index)
                ?: throw CloudContractMismatchException(
                    "$fieldPath.buckets has more buckets than expected."
                )
            val actualBucketKey = ProgressReviewScheduleBucketKey.fromWireKey(
                wireKey = bucket.requireCloudString("key", "$fieldPath.buckets[$index].key")
            )
            if (actualBucketKey != expectedBucketKey) {
                throw CloudContractMismatchException(
                    "$fieldPath.buckets[$index].key expected '${expectedBucketKey.wireKey}' but got '${actualBucketKey.wireKey}'."
                )
            }

            add(
                CloudProgressReviewScheduleBucket(
                    key = actualBucketKey,
                    count = requireNonNegativeReviewScheduleInt(
                        value = bucket.requireCloudInt("count", "$fieldPath.buckets[$index].count"),
                        fieldPath = "$fieldPath.buckets[$index].count"
                    )
                )
            )
        }
    }
    val expectedBucketCount = ProgressReviewScheduleBucketKey.orderedEntries.size
    if (buckets.size != expectedBucketCount) {
        throw CloudContractMismatchException(
            "$fieldPath.buckets expected $expectedBucketCount buckets but got ${buckets.size}."
        )
    }
    val totalCards = requireNonNegativeReviewScheduleInt(
        value = response.requireCloudInt("totalCards", "$fieldPath.totalCards"),
        fieldPath = "$fieldPath.totalCards"
    )
    val countedCards = buckets.sumOf { bucket -> bucket.count }
    if (countedCards != totalCards) {
        throw CloudContractMismatchException(
            "$fieldPath.totalCards expected bucket sum $countedCards but got $totalCards."
        )
    }

    return CloudProgressReviewSchedule(
        timeZone = response.requireCloudString("timeZone", "$fieldPath.timeZone"),
        generatedAt = response.requireCloudString("generatedAt", "$fieldPath.generatedAt"),
        reviewHistoryWatermarks = response.requireProgressReviewHistoryWatermarks(
            fieldPath = fieldPath
        ),
        totalCards = totalCards,
        buckets = buckets
    )
}

private fun JSONObject.requireProgressReviewHistoryWatermarks(
    fieldPath: String
): List<ProgressReviewHistoryWatermark> {
    if (has("reviewHistoryWatermarks").not()) {
        return emptyList()
    }

    val watermarksArray = requireCloudArray("reviewHistoryWatermarks", "$fieldPath.reviewHistoryWatermarks")
    return buildList {
        for (index in 0 until watermarksArray.length()) {
            val watermark = watermarksArray.requireCloudObject(index, "$fieldPath.reviewHistoryWatermarks[$index]")
            add(
                ProgressReviewHistoryWatermark(
                    workspaceId = watermark.requireCloudString(
                        "workspaceId",
                        "$fieldPath.reviewHistoryWatermarks[$index].workspaceId"
                    ),
                    reviewSequenceId = requireNonNegativeReviewHistorySequenceId(
                        value = watermark.requireCloudLong(
                            "reviewSequenceId",
                            "$fieldPath.reviewHistoryWatermarks[$index].reviewSequenceId"
                        ),
                        fieldPath = "$fieldPath.reviewHistoryWatermarks[$index].reviewSequenceId"
                    )
                )
            )
        }
    }
}

private fun requireNonNegativeReviewHistorySequenceId(
    value: Long,
    fieldPath: String
): Long {
    if (value < 0L) {
        throw CloudContractMismatchException("$fieldPath must not be negative.")
    }

    return value
}

private fun requireNonNegativeReviewScheduleInt(
    value: Int,
    fieldPath: String
): Int {
    if (value < 0) {
        throw CloudContractMismatchException("$fieldPath must not be negative.")
    }

    return value
}

// Shared between the live response and the local payload cache so both sides of the
// offline-first leaderboard pipeline enforce the same wire contract.
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
        participantCount = requireNonNegativeReviewScheduleInt(
            value = requireCloudInt("participantCount", "$fieldPath.participantCount"),
            fieldPath = "$fieldPath.participantCount"
        ),
        viewer = CloudProgressLeaderboardViewer(
            publicProfileId = viewer.requireCloudString("publicProfileId", "$fieldPath.viewer.publicProfileId"),
            rank = requirePositiveLeaderboardRank(
                value = viewer.requireCloudInt("rank", "$fieldPath.viewer.rank"),
                fieldPath = "$fieldPath.viewer.rank"
            ),
            qualifiedReviewCount = requireNonNegativeReviewScheduleInt(
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
        qualifiedReviewCount = requireNonNegativeReviewScheduleInt(
            value = requireCloudInt("qualifiedReviewCount", "$fieldPath.qualifiedReviewCount"),
            fieldPath = "$fieldPath.qualifiedReviewCount"
        ),
        rank = requirePositiveLeaderboardRank(
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
        qualifiedReviewCount = requireNonNegativeReviewScheduleInt(
            value = requireCloudInt("qualifiedReviewCount", "$fieldPath.qualifiedReviewCount"),
            fieldPath = "$fieldPath.qualifiedReviewCount"
        ),
        rank = requirePositiveLeaderboardRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

private fun requirePositiveLeaderboardRank(
    value: Int,
    fieldPath: String
): Int {
    if (value < 1) {
        throw CloudContractMismatchException("$fieldPath must be at least 1.")
    }

    return value
}
