package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
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
