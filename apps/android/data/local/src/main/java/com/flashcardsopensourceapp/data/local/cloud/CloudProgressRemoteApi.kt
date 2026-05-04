package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
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
        val dailyReviews = response.requireCloudArray("dailyReviews", "progress.dailyReviews")

        return CloudProgressSeries(
            timeZone = response.requireCloudString("timeZone", "progress.timeZone"),
            from = response.requireCloudString("from", "progress.from"),
            to = response.requireCloudString("to", "progress.to"),
            dailyReviews = buildList {
                for (index in 0 until dailyReviews.length()) {
                    val point = dailyReviews.requireCloudObject(index, "progress.dailyReviews[$index]")
                    add(
                        CloudDailyReviewPoint(
                            date = point.requireCloudString("date", "progress.dailyReviews[$index].date"),
                            reviewCount = point.requireCloudInt(
                                "reviewCount",
                                "progress.dailyReviews[$index].reviewCount"
                            )
                        )
                    )
                }
            },
            generatedAt = response.optCloudStringOrNull("generatedAt", "progress.generatedAt"),
            summary = null
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
}

internal fun parseCloudProgressSummaryResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressSummary {
    return response.requireCloudObject("summary", "$fieldPath.summary").toCloudProgressSummary(
        fieldPath = "$fieldPath.summary"
    )
}

private fun JSONObject.toCloudProgressSummary(
    fieldPath: String
): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = requireCloudInt("currentStreakDays", "$fieldPath.currentStreakDays"),
        hasReviewedToday = requireCloudBoolean("hasReviewedToday", "$fieldPath.hasReviewedToday"),
        lastReviewedOn = requireCloudNullableString("lastReviewedOn", "$fieldPath.lastReviewedOn"),
        activeReviewDays = requireCloudInt("activeReviewDays", "$fieldPath.activeReviewDays")
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
        totalCards = totalCards,
        buckets = buckets
    )
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
