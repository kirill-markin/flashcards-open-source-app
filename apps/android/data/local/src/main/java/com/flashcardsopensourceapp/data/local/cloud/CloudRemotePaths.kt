package com.flashcardsopensourceapp.data.local.cloud

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal fun buildPaginatedCloudPath(basePath: String, cursor: String?): String {
    val query = if (cursor == null) {
        "limit=100"
    } else {
        "limit=100&cursor=${encodeCloudQueryValue(value = cursor)}"
    }
    return "$basePath?$query"
}

internal fun buildProgressSummaryCloudPath(timeZone: String): String {
    return buildString {
        append("/me/progress/summary?timeZone=")
        append(encodeCloudQueryValue(value = timeZone))
    }
}

internal fun buildProgressSeriesCloudPath(
    timeZone: String,
    from: String,
    to: String
): String {
    return buildString {
        append("/me/progress/series?timeZone=")
        append(encodeCloudQueryValue(value = timeZone))
        append("&from=")
        append(encodeCloudQueryValue(value = from))
        append("&to=")
        append(encodeCloudQueryValue(value = to))
    }
}

private fun encodeCloudQueryValue(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8)
}
