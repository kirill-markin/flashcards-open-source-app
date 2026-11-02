package com.flashcardsopensourceapp.core.observability

interface AppPerformanceTracing {
    /** Starts a root span on its own, outside any scope-bound transaction. */
    fun startSpan(name: AppPerformanceSpanName): AppPerformanceSpan
}

interface AppPerformanceSpan {
    fun setAttribute(key: String, value: Boolean)

    fun setAttribute(key: String, value: Long)

    fun finish()
}

/**
 * Diagnostics-only review timing spans. The non-blocking review plans read their durations as the
 * before/after numbers: docs/fsrs-scheduling-logic.md#non-blocking-review
 */
enum class AppPerformanceSpanName(val spanName: String) {
    REVIEW_NEXT_CARD_VISIBLE(spanName = "review.next_card_visible"),
    REVIEW_AFTER_RATING_WORK(spanName = "review.after_rating_work")
}
