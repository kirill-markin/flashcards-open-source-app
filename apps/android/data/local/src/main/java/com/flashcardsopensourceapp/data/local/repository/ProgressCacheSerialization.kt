package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
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
        currentStreakDays = currentStreakDays,
        hasReviewedToday = hasReviewedToday,
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDays,
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
        dailyReviewsJson = JSONArray().apply {
            dailyReviews.forEach { point ->
                put(
                    JSONObject()
                        .put("date", point.date)
                        .put("reviewCount", point.reviewCount)
                )
            }
        }.toString(),
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
        CloudProgressSummary(
            currentStreakDays = currentStreakDays,
            hasReviewedToday = hasReviewedToday,
            lastReviewedOn = lastReviewedOn,
            activeReviewDays = activeReviewDays
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
        CloudProgressReviewSchedule(
            timeZone = timeZone,
            generatedAt = generatedAt,
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
                            reviewCount = point.getInt("reviewCount")
                        )
                    )
                }
            },
            generatedAt = generatedAt,
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
