package com.flashcardsopensourceapp.data.local.repository.progress.cache

import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLeaderboardCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressRepositoryWarning
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createInclusiveLocalDateRange
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.parseLocalDate
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressReviewScheduleServerCacheKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.validateProgressReviewScheduleBuckets
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.validateProgressReviewScheduleCacheTimeZone
import org.json.JSONArray
import org.json.JSONObject

internal fun CloudProgressSummary.toCacheEntity(
    scopeKey: ProgressSummaryScopeKey,
    updatedAtMillis: Long
): ProgressSummaryCacheEntity {
    return ProgressSummaryCacheEntity(
        scopeKey = serializeProgressSummaryScopeKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        reviewHistoryWatermarksJson = serializeProgressReviewHistoryWatermarks(
            watermarks = reviewHistoryWatermarks
        ),
        currentStreakDays = currentStreakDays,
        longestStreakDays = longestStreakDays,
        hasReviewedToday = hasReviewedToday,
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDays,
        streakFreezeAvailableCredits = streakFreeze.availableCredits,
        streakFreezeCapacity = streakFreeze.capacity,
        streakFreezeBalanceUnits = streakFreeze.balanceUnits,
        streakFreezeUnitsPerCredit = streakFreeze.unitsPerCredit,
        streakFreezeEarnedUnitsPerStreakDay = streakFreeze.earnedUnitsPerStreakDay,
        streakFreezeNextCreditProgressUnits = streakFreeze.nextCreditProgressUnits,
        streakFreezeNextCreditRequiredUnits = streakFreeze.nextCreditRequiredUnits,
        updatedAtMillis = updatedAtMillis
    )
}

internal fun CloudProgressSeries.toCacheEntity(
    scopeKey: ProgressSeriesScopeKey,
    updatedAtMillis: Long
): ProgressSeriesCacheEntity {
    return ProgressSeriesCacheEntity(
        scopeKey = serializeProgressSeriesScopeKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        timeZone = timeZone,
        fromLocalDate = from,
        toLocalDate = to,
        generatedAt = generatedAt,
        reviewHistoryWatermarksJson = serializeProgressReviewHistoryWatermarks(
            watermarks = reviewHistoryWatermarks
        ),
        dailyReviewsJson = JSONArray().apply {
            dailyReviews.forEach { point ->
                put(
                    JSONObject()
                        .put("date", point.date)
                        .put("reviewCount", point.reviewCount)
                        .put("againCount", point.againCount)
                        .put("hardCount", point.hardCount)
                        .put("goodCount", point.goodCount)
                        .put("easyCount", point.easyCount)
                )
            }
        }.toString(),
        streakDaysJson = serializeProgressStreakDays(streakDays = streakDays),
        updatedAtMillis = updatedAtMillis
    )
}

internal fun CloudProgressReviewSchedule.toCacheEntity(
    scopeKey: ProgressReviewScheduleScopeKey,
    updatedAtMillis: Long
): ProgressReviewScheduleCacheEntity {
    return ProgressReviewScheduleCacheEntity(
        scopeKey = serializeProgressReviewScheduleServerCacheKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        timeZone = timeZone,
        referenceLocalDate = scopeKey.referenceLocalDate,
        generatedAt = generatedAt,
        reviewHistoryWatermarksJson = serializeProgressReviewHistoryWatermarks(
            watermarks = reviewHistoryWatermarks
        ),
        totalCards = totalCards,
        bucketsJson = JSONArray().apply {
            buckets.forEach { bucket ->
                put(
                    JSONObject()
                        .put("key", bucket.key.wireKey)
                        .put("count", bucket.count)
                )
            }
        }.toString(),
        updatedAtMillis = updatedAtMillis
    )
}

internal fun CloudProgressLeaderboard.toCacheEntity(
    scopeKey: ProgressLeaderboardScopeKey,
    updatedAtMillis: Long
): ProgressLeaderboardCacheEntity {
    return ProgressLeaderboardCacheEntity(
        scopeKey = serializeProgressLeaderboardScopeKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        payloadJson = serializeCloudProgressLeaderboard(leaderboard = this).toString(),
        updatedAtMillis = updatedAtMillis
    )
}

internal fun serializeProgressLeaderboardScopeKey(
    scopeKey: ProgressLeaderboardScopeKey
): String {
    return scopeKey.scopeId
}

internal fun findProgressLeaderboardServerBase(
    leaderboardCaches: List<ProgressLeaderboardCacheEntity>,
    scopeKey: ProgressLeaderboardScopeKey
): ProgressLeaderboardCachedPayload? {
    return leaderboardCaches.asSequence()
        .filter { entry -> entry.scopeId == scopeKey.scopeId }
        .mapNotNull { entry ->
            entry.toCloudProgressLeaderboardOrNull()?.let { leaderboard ->
                ProgressLeaderboardCachedPayload(
                    leaderboard = leaderboard,
                    updatedAtMillis = entry.updatedAtMillis
                )
            }
        }
        .firstOrNull()
}

internal data class ProgressLeaderboardCachedPayload(
    val leaderboard: CloudProgressLeaderboard,
    val updatedAtMillis: Long
)

internal fun ProgressLeaderboardCacheEntity.toCloudProgressLeaderboardOrNull(): CloudProgressLeaderboard? {
    return runCatching {
        parseCloudProgressLeaderboard(
            payload = JSONObject(payloadJson),
            fieldPath = "progressLeaderboardCache"
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_leaderboard_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "scopeId" to scopeId
            ),
            error = error
        )
        null
    }
}

// The cached payload reuses the wire shape so parseCloudProgressLeaderboard reads both
// the live response and this serialized copy, including the API-provided anonymous
// display names and viewer-private friend labels.
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
                                        put(row.toCacheJson())
                                    }
                                }
                            )
                            .put(
                                "rankingRows",
                                JSONArray().apply {
                                    window.rankingRows.forEach { row ->
                                        put(row.toCacheJson())
                                    }
                                }
                            )
                    )
                }
            }
        )
}

private fun CloudProgressLeaderboardRow.toCacheJson(): JSONObject {
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

private fun CloudProgressLeaderboardRankingRow.toCacheJson(): JSONObject {
    return JSONObject()
        .put("kind", kind.wireKey)
        .put("publicProfileId", publicProfileId)
        .put("anonymousDisplayName", anonymousDisplayName)
        .putOptionalCloudString(name = "friendDisplayName", value = friendDisplayName)
        .put("qualifiedReviewCount", qualifiedReviewCount)
        .put("rank", rank)
}

private fun JSONObject.putOptionalCloudString(name: String, value: String?): JSONObject {
    if (value != null) {
        put(name, value)
    }
    return this
}

internal fun findProgressReviewScheduleServerBase(
    reviewScheduleCaches: List<ProgressReviewScheduleCacheEntity>,
    scopeKey: ProgressReviewScheduleScopeKey
): CloudProgressReviewSchedule? {
    return reviewScheduleCaches.asSequence()
        .filter { entry ->
            isProgressReviewScheduleServerCacheCandidate(
                cacheEntry = entry,
                scopeKey = scopeKey
            )
        }
        .mapNotNull { cacheEntry ->
            runCatching {
                validateProgressReviewScheduleCacheIdentity(
                    cacheEntry = cacheEntry,
                    scopeKey = scopeKey
                )
                cacheEntry.toCloudProgressReviewScheduleOrNull()
            }.getOrElse { error ->
                logProgressRepositoryWarning(
                    event = "progress_review_schedule_cache_skipped",
                    fields = listOf(
                        "scopeKey" to cacheEntry.scopeKey,
                        "scopeId" to cacheEntry.scopeId,
                        "expectedScopeId" to scopeKey.scopeId,
                        "timeZone" to cacheEntry.timeZone,
                        "expectedTimeZone" to scopeKey.timeZone,
                        "referenceLocalDate" to cacheEntry.referenceLocalDate,
                        "expectedReferenceLocalDate" to scopeKey.referenceLocalDate
                    ),
                    error = error
                )
                null
            }
        }
        .firstOrNull()
}

private fun isProgressReviewScheduleServerCacheCandidate(
    cacheEntry: ProgressReviewScheduleCacheEntity,
    scopeKey: ProgressReviewScheduleScopeKey
): Boolean {
    return cacheEntry.scopeKey == serializeProgressReviewScheduleServerCacheKey(scopeKey = scopeKey) ||
        cacheEntry.scopeKey == serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey) ||
        (
            cacheEntry.scopeId == scopeKey.scopeId &&
                cacheEntry.timeZone == scopeKey.timeZone &&
                cacheEntry.referenceLocalDate == scopeKey.referenceLocalDate
        )
}

private fun validateProgressReviewScheduleCacheIdentity(
    cacheEntry: ProgressReviewScheduleCacheEntity,
    scopeKey: ProgressReviewScheduleScopeKey
) {
    if (cacheEntry.scopeId != scopeKey.scopeId) {
        throw IllegalArgumentException(
            "Cached progress review schedule scopeId '${cacheEntry.scopeId}' did not match requested scopeId " +
                "'${scopeKey.scopeId}' for scope '${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'."
        )
    }
    validateProgressReviewScheduleCacheTimeZone(
        cacheTimeZone = cacheEntry.timeZone,
        scopeKey = scopeKey
    )
    if (cacheEntry.referenceLocalDate != scopeKey.referenceLocalDate) {
        throw IllegalArgumentException(
            "Cached progress review schedule referenceLocalDate '${cacheEntry.referenceLocalDate}' did not match " +
                "requested referenceLocalDate '${scopeKey.referenceLocalDate}' for scope " +
                "'${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'."
        )
    }
}

internal fun ProgressSummaryCacheEntity.toCloudProgressSummaryOrNull(): CloudProgressSummary? {
    return runCatching {
        lastReviewedOn?.let { cachedLastReviewedOn ->
            parseLocalDate(rawDate = cachedLastReviewedOn)
        }
        val reviewHistoryWatermarks = parseProgressReviewHistoryWatermarks(
            rawJson = reviewHistoryWatermarksJson
        )
        CloudProgressSummary(
            currentStreakDays = requireNonNegativeProgressCacheInt(
                value = currentStreakDays,
                fieldPath = "progressSummaryCache.currentStreakDays"
            ),
            longestStreakDays = requireNonNegativeProgressCacheInt(
                value = longestStreakDays,
                fieldPath = "progressSummaryCache.longestStreakDays"
            ),
            hasReviewedToday = hasReviewedToday,
            lastReviewedOn = lastReviewedOn,
            activeReviewDays = requireNonNegativeProgressCacheInt(
                value = activeReviewDays,
                fieldPath = "progressSummaryCache.activeReviewDays"
            ),
            streakFreeze = CloudProgressStreakFreeze(
                availableCredits = requireNonNegativeProgressCacheInt(
                    value = streakFreezeAvailableCredits,
                    fieldPath = "progressSummaryCache.streakFreezeAvailableCredits"
                ),
                capacity = requireNonNegativeProgressCacheInt(
                    value = streakFreezeCapacity,
                    fieldPath = "progressSummaryCache.streakFreezeCapacity"
                ),
                balanceUnits = requireNonNegativeProgressCacheInt(
                    value = streakFreezeBalanceUnits,
                    fieldPath = "progressSummaryCache.streakFreezeBalanceUnits"
                ),
                unitsPerCredit = requirePositiveProgressCacheInt(
                    value = streakFreezeUnitsPerCredit,
                    fieldPath = "progressSummaryCache.streakFreezeUnitsPerCredit"
                ),
                earnedUnitsPerStreakDay = requireNonNegativeProgressCacheInt(
                    value = streakFreezeEarnedUnitsPerStreakDay,
                    fieldPath = "progressSummaryCache.streakFreezeEarnedUnitsPerStreakDay"
                ),
                nextCreditProgressUnits = requireNonNegativeProgressCacheInt(
                    value = streakFreezeNextCreditProgressUnits,
                    fieldPath = "progressSummaryCache.streakFreezeNextCreditProgressUnits"
                ),
                nextCreditRequiredUnits = requirePositiveProgressCacheInt(
                    value = streakFreezeNextCreditRequiredUnits,
                    fieldPath = "progressSummaryCache.streakFreezeNextCreditRequiredUnits"
                )
            ),
            reviewHistoryWatermarks = reviewHistoryWatermarks
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_summary_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "timeZone" to timeZone,
                "lastReviewedOn" to lastReviewedOn
            ),
            error = error
        )
        null
    }
}

internal fun ProgressReviewScheduleCacheEntity.toCloudProgressReviewScheduleOrNull(): CloudProgressReviewSchedule? {
    return runCatching {
        parseLocalDate(rawDate = referenceLocalDate)
        val bucketsArray = JSONArray(bucketsJson)
        val buckets = buildList {
            for (index in 0 until bucketsArray.length()) {
                val bucket = bucketsArray.getJSONObject(index)
                add(
                    CloudProgressReviewScheduleBucket(
                        key = ProgressReviewScheduleBucketKey.fromWireKey(
                            wireKey = bucket.getString("key")
                        ),
                        count = bucket.getInt("count")
                    )
                )
            }
        }
        validateProgressReviewScheduleBuckets(
            buckets = buckets,
            totalCards = totalCards
        )
        val reviewHistoryWatermarks = parseProgressReviewHistoryWatermarks(
            rawJson = reviewHistoryWatermarksJson
        )
        CloudProgressReviewSchedule(
            timeZone = timeZone,
            generatedAt = generatedAt,
            reviewHistoryWatermarks = reviewHistoryWatermarks,
            totalCards = totalCards,
            buckets = buckets
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_review_schedule_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "timeZone" to timeZone,
                "referenceLocalDate" to referenceLocalDate
            ),
            error = error
        )
        null
    }
}

internal fun ProgressSeriesCacheEntity.toCloudProgressSeriesOrNull(): CloudProgressSeries? {
    return runCatching {
        val parsedFrom = parseLocalDate(rawDate = fromLocalDate)
        val parsedTo = parseLocalDate(rawDate = toLocalDate)
        if (parsedFrom.isAfter(parsedTo)) {
            throw IllegalArgumentException(
                "Invalid progress series cache range '$fromLocalDate' > '$toLocalDate'."
            )
        }

        val dailyReviewsArray = JSONArray(dailyReviewsJson)
        val streakDays = parseProgressStreakDays(rawJson = streakDaysJson)
        validateProgressStreakDaysForRange(
            streakDays = streakDays,
            from = fromLocalDate,
            to = toLocalDate
        )
        val reviewHistoryWatermarks = parseProgressReviewHistoryWatermarks(
            rawJson = reviewHistoryWatermarksJson
        )
        CloudProgressSeries(
            timeZone = timeZone,
            from = fromLocalDate,
            to = toLocalDate,
            dailyReviews = buildList {
                for (index in 0 until dailyReviewsArray.length()) {
                    val point = dailyReviewsArray.getJSONObject(index)
                    val date = point.getString("date")
                    parseLocalDate(rawDate = date)
                    add(
                        CloudDailyReviewPoint(
                            date = date,
                            reviewCount = point.getInt("reviewCount"),
                            againCount = point.getInt("againCount"),
                            hardCount = point.getInt("hardCount"),
                            goodCount = point.getInt("goodCount"),
                            easyCount = point.getInt("easyCount")
                        )
                    )
                }
            },
            streakDays = streakDays,
            generatedAt = generatedAt,
            reviewHistoryWatermarks = reviewHistoryWatermarks,
            summary = null
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_series_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "timeZone" to timeZone,
                "fromLocalDate" to fromLocalDate,
                "toLocalDate" to toLocalDate
            ),
            error = error
        )
        null
    }
}

private fun serializeProgressStreakDays(
    streakDays: List<CloudProgressStreakDay>
): String {
    return JSONArray().apply {
        streakDays.forEach { day ->
            put(
                JSONObject()
                    .put("date", day.date)
                    .put("state", day.state.wireKey)
            )
        }
    }.toString()
}

private fun parseProgressStreakDays(
    rawJson: String
): List<CloudProgressStreakDay> {
    val streakDaysArray = JSONArray(rawJson)
    return buildList {
        for (index in 0 until streakDaysArray.length()) {
            val day = streakDaysArray.getJSONObject(index)
            val date = day.getString("date")
            parseLocalDate(rawDate = date)
            add(
                CloudProgressStreakDay(
                    date = date,
                    state = CloudProgressStreakDayState.fromWireKey(
                        wireKey = day.getString("state")
                    )
                )
            )
        }
    }
}

private fun validateProgressStreakDaysForRange(
    streakDays: List<CloudProgressStreakDay>,
    from: String,
    to: String
) {
    val expectedDates = createInclusiveLocalDateRange(
        from = from,
        to = to
    )
    val actualDates = streakDays.map(CloudProgressStreakDay::date)
    if (actualDates != expectedDates) {
        throw IllegalArgumentException(
            "Progress series cache streakDays must cover the cached range from '$from' to '$to'."
        )
    }
}

private fun serializeProgressReviewHistoryWatermarks(
    watermarks: List<ProgressReviewHistoryWatermark>
): String {
    return JSONArray().apply {
        watermarks.forEach { watermark ->
            put(
                JSONObject()
                    .put("workspaceId", watermark.workspaceId)
                    .put("reviewSequenceId", watermark.reviewSequenceId)
            )
        }
    }.toString()
}

private fun parseProgressReviewHistoryWatermarks(
    rawJson: String
): List<ProgressReviewHistoryWatermark> {
    val watermarksArray = JSONArray(rawJson)
    return buildList {
        for (index in 0 until watermarksArray.length()) {
            val watermark = watermarksArray.getJSONObject(index)
            val workspaceId = watermark.getString("workspaceId")
            if (workspaceId.isBlank()) {
                throw IllegalArgumentException("Progress review-history watermark workspaceId must not be blank.")
            }
            add(
                ProgressReviewHistoryWatermark(
                    workspaceId = workspaceId,
                    reviewSequenceId = parseProgressReviewHistorySequenceId(
                        watermark = watermark
                    )
                )
            )
        }
    }
}

private fun parseProgressReviewHistorySequenceId(watermark: JSONObject): Long {
    val value = watermark.get("reviewSequenceId") as? Number
    if (value == null) {
        throw IllegalArgumentException("Progress review-history watermark reviewSequenceId must be an integer.")
    }

    val longValue = value.toLong()
    if (value.toDouble() != longValue.toDouble() || longValue < 0L) {
        throw IllegalArgumentException("Progress review-history watermark reviewSequenceId must be non-negative.")
    }

    return longValue
}

private fun requireNonNegativeProgressCacheInt(
    value: Int,
    fieldPath: String
): Int {
    if (value < 0) {
        throw IllegalArgumentException("$fieldPath must not be negative.")
    }

    return value
}

private fun requirePositiveProgressCacheInt(
    value: Int,
    fieldPath: String
): Int {
    if (value <= 0) {
        throw IllegalArgumentException("$fieldPath must be positive.")
    }

    return value
}
