package com.flashcardsopensourceapp.data.local.model

data class ProgressSummaryScopeKey(
    val scopeId: String,
    val timeZone: String,
    val referenceLocalDate: String
)

data class ProgressSeriesScopeKey(
    val scopeId: String,
    val timeZone: String,
    val from: String,
    val to: String
)

enum class ProgressSnapshotSource {
    LOCAL_ONLY,
    SERVER_BASE,
    SERVER_BASE_WITH_LOCAL_OVERLAY
}

data class ProgressSummarySnapshot(
    val scopeKey: ProgressSummaryScopeKey,
    val renderedSummary: CloudProgressSummary,
    val localFallback: CloudProgressSummary,
    val serverBase: CloudProgressSummary?,
    val source: ProgressSnapshotSource,
    val isApproximate: Boolean
)

data class ProgressSeriesSnapshot(
    val scopeKey: ProgressSeriesScopeKey,
    val renderedSeries: CloudProgressSeries,
    val localFallback: CloudProgressSeries,
    val serverBase: CloudProgressSeries?,
    val pendingLocalOverlay: CloudProgressSeries,
    val source: ProgressSnapshotSource,
    val isApproximate: Boolean
)
