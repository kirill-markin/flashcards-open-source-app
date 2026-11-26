package com.flashcardsopensourceapp.data.local.cloud.remote.progress

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressLeaderboardCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressLeaderboardProfileCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressReviewScheduleCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressSeriesCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressSummaryCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildProgressStreakLeaderboardCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudDoubleOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudArrayOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudIsoTimestamp
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudLocalDate
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.cloud.wire.parseCloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNonNegativeInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudPositiveRank
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressBestDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressBestWeek
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressInsights
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileBestRatingPlacement
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileMetrics
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileReviewActivity
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileReviewActivityDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileStats
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStudySecondsDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileReviewActivityDateBasis
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject

private const val leaderboardProfileReviewActivityDayCount: Int = 30

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

    suspend fun loadProgressStreakLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressStreakLeaderboard {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressStreakLeaderboardCloudPath(),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressStreakLeaderboard(
            payload = response,
            fieldPath = "progress.streakLeaderboard"
        )
    }

    suspend fun loadProgressLeaderboardProfile(
        apiBaseUrl: String,
        authorizationHeader: String,
        publicProfileId: String
    ): CloudProgressLeaderboardProfile {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressLeaderboardProfileCloudPath(publicProfileId = publicProfileId),
            authorizationHeader = authorizationHeader
        )
        val profile = parseCloudProgressLeaderboardProfile(
            payload = response,
            fieldPath = "progress.leaderboardProfile"
        )
        if (
            profile is CloudProgressLeaderboardProfile.Ready &&
            profile.publicProfileId != publicProfileId
        ) {
            throw CloudContractMismatchException(
                "progress.leaderboardProfile.publicProfileId expected requested profile '$publicProfileId' but got '${profile.publicProfileId}'."
            )
        }
        return profile
    }
}

internal fun parseCloudProgressSummaryResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressSummary {
    val reviewHistoryWatermarks = response.requireProgressReviewHistoryWatermarks(
        fieldPath = fieldPath
    )
    // Older servers omit insights.
    val insights = response.optCloudObjectOrNull("insights", "$fieldPath.insights")?.let { payload ->
        parseCloudProgressInsights(payload = payload, fieldPath = "$fieldPath.insights")
    }
    return response.requireCloudObject("summary", "$fieldPath.summary").toCloudProgressSummary(
        fieldPath = "$fieldPath.summary",
        reviewHistoryWatermarks = reviewHistoryWatermarks,
        insights = insights
    )
}

// Shared between the live response and the summary cache, which stores the wire payload.
internal fun parseCloudProgressInsights(
    payload: JSONObject,
    fieldPath: String
): CloudProgressInsights {
    val studySecondsByDay = payload.optCloudArrayOrNull("studySecondsByDay", "$fieldPath.studySecondsByDay")
    val secondsPerDueCard = payload.optCloudDoubleOrNull("secondsPerDueCard", "$fieldPath.secondsPerDueCard")
    if (secondsPerDueCard != null && secondsPerDueCard < 0.0) {
        throw CloudContractMismatchException("$fieldPath.secondsPerDueCard must not be negative.")
    }
    return CloudProgressInsights(
        totalReviews = requireNonNegativeProgressInt(
            value = payload.requireCloudInt("totalReviews", "$fieldPath.totalReviews"),
            fieldPath = "$fieldPath.totalReviews"
        ),
        bestDayBeforeToday = payload.optCloudObjectOrNull(
            "bestDayBeforeToday",
            "$fieldPath.bestDayBeforeToday"
        )?.let { bestDay ->
            CloudProgressBestDay(
                date = parseCloudLocalDate(
                    value = bestDay.requireCloudString("date", "$fieldPath.bestDayBeforeToday.date"),
                    fieldPath = "$fieldPath.bestDayBeforeToday.date"
                ).toString(),
                reviewCount = requireNonNegativeProgressInt(
                    value = bestDay.requireCloudInt("reviewCount", "$fieldPath.bestDayBeforeToday.reviewCount"),
                    fieldPath = "$fieldPath.bestDayBeforeToday.reviewCount"
                )
            )
        },
        bestWeekBeforeToday = payload.optCloudObjectOrNull(
            "bestWeekBeforeToday",
            "$fieldPath.bestWeekBeforeToday"
        )?.let { bestWeek ->
            CloudProgressBestWeek(
                endDate = parseCloudLocalDate(
                    value = bestWeek.requireCloudString("endDate", "$fieldPath.bestWeekBeforeToday.endDate"),
                    fieldPath = "$fieldPath.bestWeekBeforeToday.endDate"
                ).toString(),
                reviewCount = requireNonNegativeProgressInt(
                    value = bestWeek.requireCloudInt("reviewCount", "$fieldPath.bestWeekBeforeToday.reviewCount"),
                    fieldPath = "$fieldPath.bestWeekBeforeToday.reviewCount"
                )
            )
        },
        cardsMetLast7Days = requireNonNegativeProgressInt(
            value = payload.requireCloudInt("cardsMetLast7Days", "$fieldPath.cardsMetLast7Days"),
            fieldPath = "$fieldPath.cardsMetLast7Days"
        ),
        relearnedLast7Days = requireNonNegativeProgressInt(
            value = payload.requireCloudInt("relearnedLast7Days", "$fieldPath.relearnedLast7Days"),
            fieldPath = "$fieldPath.relearnedLast7Days"
        ),
        secondsPerDueCard = secondsPerDueCard,
        studySecondsByDay = studySecondsByDay?.let { days ->
            buildList {
                for (index in 0 until days.length()) {
                    val day = days.requireCloudObject(index, "$fieldPath.studySecondsByDay[$index]")
                    val dayFieldPath = "$fieldPath.studySecondsByDay[$index]"
                    add(
                        CloudProgressStudySecondsDay(
                            date = parseCloudLocalDate(
                                value = day.requireCloudString("date", "$dayFieldPath.date"),
                                fieldPath = "$dayFieldPath.date"
                            ).toString(),
                            seconds = requireNonNegativeProgressInt(
                                value = day.requireCloudInt("seconds", "$dayFieldPath.seconds"),
                                fieldPath = "$dayFieldPath.seconds"
                            )
                        )
                    )
                }
            }
        }
    )
}

// Shared with the summary cache so both sides write the same wire payload.
internal fun serializeCloudProgressInsights(insights: CloudProgressInsights): JSONObject {
    return JSONObject()
        .put("totalReviews", insights.totalReviews)
        .put(
            "bestDayBeforeToday",
            insights.bestDayBeforeToday?.let { bestDay ->
                JSONObject()
                    .put("date", bestDay.date)
                    .put("reviewCount", bestDay.reviewCount)
            } ?: JSONObject.NULL
        )
        .put(
            "bestWeekBeforeToday",
            insights.bestWeekBeforeToday?.let { bestWeek ->
                JSONObject()
                    .put("endDate", bestWeek.endDate)
                    .put("reviewCount", bestWeek.reviewCount)
            } ?: JSONObject.NULL
        )
        .put("cardsMetLast7Days", insights.cardsMetLast7Days)
        .put("relearnedLast7Days", insights.relearnedLast7Days)
        .put("secondsPerDueCard", insights.secondsPerDueCard ?: JSONObject.NULL)
        .put(
            "studySecondsByDay",
            insights.studySecondsByDay?.let { days ->
                JSONArray().apply {
                    days.forEach { day ->
                        put(
                            JSONObject()
                                .put("date", day.date)
                                .put("seconds", day.seconds)
                        )
                    }
                }
            } ?: JSONObject.NULL
        )
}

internal fun parseCloudProgressSeriesResponse(
    response: JSONObject,
    fieldPath: String
): CloudProgressSeries {
    val dailyReviews = response.requireCloudArray("dailyReviews", "$fieldPath.dailyReviews")
    val from = response.requireCloudString("from", "$fieldPath.from")
    val to = response.requireCloudString("to", "$fieldPath.to")
    val streakDays = response.toCloudProgressStreakDays(
        fieldPath = fieldPath
    )
    validateCloudProgressStreakDaysForRange(
        streakDays = streakDays,
        from = from,
        to = to,
        streakDaysFieldPath = "$fieldPath.streakDays",
        rangeFieldPath = fieldPath
    )

    return CloudProgressSeries(
        timeZone = response.requireCloudString("timeZone", "$fieldPath.timeZone"),
        from = from,
        to = to,
        dailyReviews = buildList {
            for (index in 0 until dailyReviews.length()) {
                val point = dailyReviews.requireCloudObject(index, "$fieldPath.dailyReviews[$index]")
                val pointFieldPath = "$fieldPath.dailyReviews[$index]"
                val reviewCount = requireNonNegativeProgressCount(
                    value = point.requireCloudInt("reviewCount", "$pointFieldPath.reviewCount"),
                    fieldPath = "$pointFieldPath.reviewCount"
                )
                val againCount = requireNonNegativeProgressCount(
                    value = point.requireCloudInt("againCount", "$pointFieldPath.againCount"),
                    fieldPath = "$pointFieldPath.againCount"
                )
                val hardCount = requireNonNegativeProgressCount(
                    value = point.requireCloudInt("hardCount", "$pointFieldPath.hardCount"),
                    fieldPath = "$pointFieldPath.hardCount"
                )
                val goodCount = requireNonNegativeProgressCount(
                    value = point.requireCloudInt("goodCount", "$pointFieldPath.goodCount"),
                    fieldPath = "$pointFieldPath.goodCount"
                )
                val easyCount = requireNonNegativeProgressCount(
                    value = point.requireCloudInt("easyCount", "$pointFieldPath.easyCount"),
                    fieldPath = "$pointFieldPath.easyCount"
                )
                requireDailyReviewCountVector(
                    reviewCount = reviewCount,
                    againCount = againCount,
                    hardCount = hardCount,
                    goodCount = goodCount,
                    easyCount = easyCount,
                    fieldPath = pointFieldPath
                )
                add(
                    CloudDailyReviewPoint(
                        date = point.requireCloudString("date", "$pointFieldPath.date"),
                        reviewCount = reviewCount,
                        againCount = againCount,
                        hardCount = hardCount,
                        goodCount = goodCount,
                        easyCount = easyCount
                    )
                )
            }
        },
        streakDays = streakDays,
        generatedAt = response.optCloudStringOrNull("generatedAt", "$fieldPath.generatedAt"),
        reviewHistoryWatermarks = response.requireProgressReviewHistoryWatermarks(
            fieldPath = fieldPath
        ),
        summary = null
    )
}

private fun JSONObject.toCloudProgressSummary(
    fieldPath: String,
    reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>,
    insights: CloudProgressInsights?
): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = requireNonNegativeProgressInt(
            value = requireCloudInt("currentStreakDays", "$fieldPath.currentStreakDays"),
            fieldPath = "$fieldPath.currentStreakDays"
        ),
        longestStreakDays = requireNonNegativeProgressInt(
            value = requireCloudInt("longestStreakDays", "$fieldPath.longestStreakDays"),
            fieldPath = "$fieldPath.longestStreakDays"
        ),
        hasReviewedToday = requireCloudBoolean("hasReviewedToday", "$fieldPath.hasReviewedToday"),
        lastReviewedOn = requireCloudNullableString("lastReviewedOn", "$fieldPath.lastReviewedOn"),
        activeReviewDays = requireNonNegativeProgressInt(
            value = requireCloudInt("activeReviewDays", "$fieldPath.activeReviewDays"),
            fieldPath = "$fieldPath.activeReviewDays"
        ),
        streakFreeze = requireCloudObject("streakFreeze", "$fieldPath.streakFreeze").toCloudProgressStreakFreeze(
            fieldPath = "$fieldPath.streakFreeze"
        ),
        reviewHistoryWatermarks = reviewHistoryWatermarks,
        insights = insights
    )
}

private fun JSONObject.toCloudProgressStreakFreeze(
    fieldPath: String
): CloudProgressStreakFreeze {
    try {
        return CloudProgressStreakFreeze(
            availableCredits = requireNonNegativeProgressInt(
                value = requireCloudInt("availableCredits", "$fieldPath.availableCredits"),
                fieldPath = "$fieldPath.availableCredits"
            ),
            capacity = requireNonNegativeProgressInt(
                value = requireCloudInt("capacity", "$fieldPath.capacity"),
                fieldPath = "$fieldPath.capacity"
            ),
            balanceUnits = requireNonNegativeProgressInt(
                value = requireCloudInt("balanceUnits", "$fieldPath.balanceUnits"),
                fieldPath = "$fieldPath.balanceUnits"
            ),
            unitsPerCredit = requirePositiveProgressInt(
                value = requireCloudInt("unitsPerCredit", "$fieldPath.unitsPerCredit"),
                fieldPath = "$fieldPath.unitsPerCredit"
            ),
            earnedUnitsPerStreakDay = requireNonNegativeProgressInt(
                value = requireCloudInt("earnedUnitsPerStreakDay", "$fieldPath.earnedUnitsPerStreakDay"),
                fieldPath = "$fieldPath.earnedUnitsPerStreakDay"
            ),
            nextCreditProgressUnits = requireNonNegativeProgressInt(
                value = requireCloudInt("nextCreditProgressUnits", "$fieldPath.nextCreditProgressUnits"),
                fieldPath = "$fieldPath.nextCreditProgressUnits"
            ),
            nextCreditRequiredUnits = requirePositiveProgressInt(
                value = requireCloudInt("nextCreditRequiredUnits", "$fieldPath.nextCreditRequiredUnits"),
                fieldPath = "$fieldPath.nextCreditRequiredUnits"
            )
        )
    } catch (error: IllegalArgumentException) {
        throw CloudContractMismatchException(
            "$fieldPath is not a coherent streak freeze payload: ${error.message}",
            error
        )
    }
}

private fun JSONObject.toCloudProgressStreakDays(
    fieldPath: String
): List<CloudProgressStreakDay> {
    val streakDays = requireCloudArray("streakDays", "$fieldPath.streakDays")
    return buildList {
        for (index in 0 until streakDays.length()) {
            val day = streakDays.requireCloudObject(index, "$fieldPath.streakDays[$index]")
            add(
                CloudProgressStreakDay(
                    date = day.requireCloudString("date", "$fieldPath.streakDays[$index].date"),
                    state = CloudProgressStreakDayState.fromWireKey(
                        wireKey = day.requireCloudString("state", "$fieldPath.streakDays[$index].state")
                    )
                )
            )
        }
    }
}

private fun validateCloudProgressStreakDaysForRange(
    streakDays: List<CloudProgressStreakDay>,
    from: String,
    to: String,
    streakDaysFieldPath: String,
    rangeFieldPath: String
) {
    val expectedDates = createCloudProgressDateRange(
        from = from,
        to = to,
        fieldPath = rangeFieldPath
    )
    val actualDates = streakDays.map(CloudProgressStreakDay::date)
    if (actualDates != expectedDates) {
        throw CloudContractMismatchException(
            "$streakDaysFieldPath must cover every date from '$from' to '$to'."
        )
    }
}

private fun createCloudProgressDateRange(
    from: String,
    to: String,
    fieldPath: String
): List<String> {
    val startDate = parseCloudLocalDate(
        value = from,
        fieldPath = "$fieldPath.from"
    )
    val endDate = parseCloudLocalDate(
        value = to,
        fieldPath = "$fieldPath.to"
    )
    if (startDate.isAfter(endDate)) {
        throw CloudContractMismatchException("$fieldPath range start must not be after range end.")
    }

    val dates = mutableListOf<String>()
    var currentDate = startDate
    while (currentDate <= endDate) {
        dates.add(currentDate.toString())
        currentDate = currentDate.plusDays(1L)
    }
    return dates
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
                    count = requireCloudNonNegativeInt(
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
    val totalCards = requireCloudNonNegativeInt(
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

private fun requireNonNegativeProgressCount(
    value: Int,
    fieldPath: String
): Int {
    if (value < 0) {
        throw CloudContractMismatchException("$fieldPath must not be negative.")
    }

    return value
}

private fun requireNonNegativeProgressInt(
    value: Int,
    fieldPath: String
): Int {
    if (value < 0) {
        throw CloudContractMismatchException("$fieldPath must not be negative.")
    }

    return value
}

private fun requireDailyReviewCountVector(
    reviewCount: Int,
    againCount: Int,
    hardCount: Int,
    goodCount: Int,
    easyCount: Int,
    fieldPath: String
) {
    val ratingCountTotal = againCount + hardCount + goodCount + easyCount
    if (reviewCount != ratingCountTotal) {
        throw CloudContractMismatchException(
            "$fieldPath.reviewCount expected rating bucket sum $ratingCountTotal but got $reviewCount."
        )
    }
}

private fun requirePositiveProgressInt(
    value: Int,
    fieldPath: String
): Int {
    if (value <= 0) {
        throw CloudContractMismatchException("$fieldPath must be positive.")
    }

    return value
}

internal fun parseCloudProgressLeaderboardProfile(
    payload: JSONObject,
    fieldPath: String
): CloudProgressLeaderboardProfile {
    val status = ProgressLeaderboardProfileStatus.fromWireKey(
        wireKey = payload.requireCloudString("status", "$fieldPath.status")
    )
    if (status != ProgressLeaderboardProfileStatus.READY) {
        return CloudProgressLeaderboardProfile.NonReady(status = status)
    }

    val generatedAt = payload.requireCloudString("generatedAt", "$fieldPath.generatedAt")
    parseCloudIsoTimestamp(
        value = generatedAt,
        fieldPath = "$fieldPath.generatedAt"
    )

    return CloudProgressLeaderboardProfile.Ready(
        status = status,
        publicProfileId = requireNonBlankProgressString(
            value = payload.requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
            fieldPath = "$fieldPath.publicProfileId"
        ),
        anonymousDisplayName = requireNonBlankProgressString(
            value = payload.requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
            fieldPath = "$fieldPath.anonymousDisplayName"
        ),
        friendDisplayName = payload.optCloudStringOrNull("friendDisplayName", "$fieldPath.friendDisplayName"),
        isFriend = payload.requireCloudBoolean("isFriend", "$fieldPath.isFriend"),
        metrics = payload.requireCloudObject("metrics", "$fieldPath.metrics")
            .toCloudProgressLeaderboardProfileMetrics(fieldPath = "$fieldPath.metrics"),
        reviewActivity = payload.requireCloudObject("reviewActivity", "$fieldPath.reviewActivity")
            .toCloudProgressLeaderboardProfileReviewActivity(fieldPath = "$fieldPath.reviewActivity"),
        stats = payload.requireCloudObject("stats", "$fieldPath.stats")
            .toCloudProgressLeaderboardProfileStats(fieldPath = "$fieldPath.stats"),
        generatedAt = generatedAt
    )
}

private fun JSONObject.toCloudProgressLeaderboardProfileMetrics(
    fieldPath: String
): CloudProgressLeaderboardProfileMetrics {
    return CloudProgressLeaderboardProfileMetrics(
        currentStreakDays = requireCloudNonNegativeInt(
            value = requireCloudInt("currentStreakDays", "$fieldPath.currentStreakDays"),
            fieldPath = "$fieldPath.currentStreakDays"
        ),
        bestRatingPlacement = requireCloudNullableLeaderboardProfileBestRatingPlacement(
            key = "bestRatingPlacement",
            fieldPath = "$fieldPath.bestRatingPlacement"
        )
    )
}

private fun JSONObject.requireCloudNullableLeaderboardProfileBestRatingPlacement(
    key: String,
    fieldPath: String
): CloudProgressLeaderboardProfileBestRatingPlacement? {
    if (has(key).not()) {
        throw CloudContractMismatchException("Cloud contract mismatch for $fieldPath: expected present value.")
    }

    val value = get(key)
    return when {
        value === JSONObject.NULL -> null
        value is JSONObject -> value.toCloudProgressLeaderboardProfileBestRatingPlacement(fieldPath = fieldPath)
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected object or null."
        )
    }
}

private fun JSONObject.toCloudProgressLeaderboardProfileBestRatingPlacement(
    fieldPath: String
): CloudProgressLeaderboardProfileBestRatingPlacement {
    return CloudProgressLeaderboardProfileBestRatingPlacement(
        windowKey = ProgressLeaderboardWindowKey.fromWireKey(
            wireKey = requireCloudString("windowKey", "$fieldPath.windowKey")
        ),
        rank = requireCloudPositiveRank(
            value = requireCloudInt("rank", "$fieldPath.rank"),
            fieldPath = "$fieldPath.rank"
        )
    )
}

private fun JSONObject.toCloudProgressLeaderboardProfileReviewActivity(
    fieldPath: String
): CloudProgressLeaderboardProfileReviewActivity {
    val daysArray = requireCloudArray("days", "$fieldPath.days")
    val days = buildList {
        for (index in 0 until daysArray.length()) {
            val dayFieldPath = "$fieldPath.days[$index]"
            val day = daysArray.requireCloudObject(index, dayFieldPath)
            add(
                CloudProgressLeaderboardProfileReviewActivityDay(
                    date = day.requireCloudString("date", "$dayFieldPath.date"),
                    reviewCount = requireCloudNonNegativeInt(
                        value = day.requireCloudInt("reviewCount", "$dayFieldPath.reviewCount"),
                        fieldPath = "$dayFieldPath.reviewCount"
                    )
                )
            )
        }
    }
    validateCloudProgressLeaderboardProfileReviewActivityDays(
        days = days,
        fieldPath = "$fieldPath.days"
    )

    return CloudProgressLeaderboardProfileReviewActivity(
        dateBasis = ProgressLeaderboardProfileReviewActivityDateBasis.fromWireKey(
            wireKey = requireCloudString("dateBasis", "$fieldPath.dateBasis")
        ),
        days = days
    )
}

private fun validateCloudProgressLeaderboardProfileReviewActivityDays(
    days: List<CloudProgressLeaderboardProfileReviewActivityDay>,
    fieldPath: String
) {
    if (days.size != leaderboardProfileReviewActivityDayCount) {
        throw CloudContractMismatchException(
            "$fieldPath expected $leaderboardProfileReviewActivityDayCount entries but got ${days.size}."
        )
    }

    var previousDate: LocalDate? = null
    days.forEachIndexed { index, day ->
        val date = parseCloudLocalDate(
            value = day.date,
            fieldPath = "$fieldPath[$index].date"
        )
        val expectedDate = previousDate?.plusDays(1L)
        if (expectedDate != null && date != expectedDate) {
            throw CloudContractMismatchException(
                "$fieldPath[$index].date expected '${expectedDate}' after the previous entry but got '${day.date}'."
            )
        }
        previousDate = date
    }
}

private fun JSONObject.toCloudProgressLeaderboardProfileStats(
    fieldPath: String
): CloudProgressLeaderboardProfileStats {
    val joinedAt = requireCloudString("joinedAt", "$fieldPath.joinedAt")
    parseCloudIsoTimestamp(
        value = joinedAt,
        fieldPath = "$fieldPath.joinedAt"
    )

    return CloudProgressLeaderboardProfileStats(
        joinedAt = joinedAt,
        totalCards = requireCloudNonNegativeInt(
            value = requireCloudInt("totalCards", "$fieldPath.totalCards"),
            fieldPath = "$fieldPath.totalCards"
        )
    )
}

private fun requireNonBlankProgressString(
    value: String,
    fieldPath: String
): String {
    if (value.isBlank()) {
        throw CloudContractMismatchException("$fieldPath must not be blank.")
    }

    return value
}
