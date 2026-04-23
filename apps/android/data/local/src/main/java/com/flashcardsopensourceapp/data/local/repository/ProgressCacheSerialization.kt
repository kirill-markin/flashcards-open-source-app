package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
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
