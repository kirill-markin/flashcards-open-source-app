package com.flashcardsopensourceapp.app.widget

import android.content.Intent
import android.util.Log
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsWidgetKind
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsWidgetSize
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsWidgetTarget

enum class WidgetTapDestination {
    REVIEW,
    PROGRESS
}

/**
 * [workspaceId] and [cardId] are set only for a [WidgetTapDestination.REVIEW] tap, and [revealAnswer]
 * only with a [cardId].
 */
data class ReviewWidgetTapRequest(
    val destination: WidgetTapDestination,
    val workspaceId: String?,
    val size: ReviewWidgetSize,
    val kind: WidgetKind,
    val cardId: String?,
    val revealAnswer: Boolean
)

fun analyticsWidgetSize(size: ReviewWidgetSize): AnalyticsWidgetSize {
    return when (size) {
        ReviewWidgetSize.SMALL -> AnalyticsWidgetSize.SMALL
        ReviewWidgetSize.MEDIUM -> AnalyticsWidgetSize.MEDIUM
        ReviewWidgetSize.LARGE -> AnalyticsWidgetSize.LARGE
    }
}

fun analyticsWidgetKind(kind: WidgetKind): AnalyticsWidgetKind {
    return when (kind) {
        WidgetKind.REVIEW -> AnalyticsWidgetKind.REVIEW
        WidgetKind.ACTIVITY -> AnalyticsWidgetKind.ACTIVITY
        WidgetKind.YEAR -> AnalyticsWidgetKind.YEAR
        WidgetKind.TODAY -> AnalyticsWidgetKind.TODAY
        WidgetKind.REVIEWS_CHART -> AnalyticsWidgetKind.REVIEWS_CHART
        WidgetKind.STREAKS -> AnalyticsWidgetKind.STREAKS
        WidgetKind.MONTH_CALENDAR -> AnalyticsWidgetKind.MONTH_CALENDAR
        WidgetKind.COMING_UP -> AnalyticsWidgetKind.COMING_UP
        WidgetKind.DASHBOARD -> AnalyticsWidgetKind.DASHBOARD
        WidgetKind.QUESTION -> AnalyticsWidgetKind.QUESTION
    }
}

fun analyticsWidgetTarget(request: ReviewWidgetTapRequest): AnalyticsWidgetTarget? {
    return when {
        request.cardId == null -> null
        request.revealAnswer -> AnalyticsWidgetTarget.REVEAL_ANSWER
        else -> AnalyticsWidgetTarget.CARD
    }
}

private const val reviewWidgetLogTag: String = "FlashcardsReviewWidget"

/**
 * The widget tap [intent] carries, or null for any other launch. The tap is cleared from [intent], so
 * a configuration change that re-delivers the same intent does not report it twice.
 */
fun consumeReviewWidgetTapRequest(intent: Intent): ReviewWidgetTapRequest? {
    val destination: WidgetTapDestination = when (intent.action) {
        ReviewWidgetTapContract.ACTION_OPEN_REVIEW -> WidgetTapDestination.REVIEW
        ReviewWidgetTapContract.ACTION_OPEN_PROGRESS -> WidgetTapDestination.PROGRESS
        else -> return null
    }
    val rawSize: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_SIZE)
    val rawKind: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_KIND)
    val workspaceId: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_WORKSPACE_ID)
    val cardId: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_CARD_ID)
    val revealAnswer: Boolean = cardId != null &&
        intent.getBooleanExtra(ReviewWidgetTapContract.EXTRA_WIDGET_REVEAL_ANSWER, false)
    intent.action = null
    intent.data = null
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_SIZE)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_KIND)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_WORKSPACE_ID)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_CARD_ID)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_REVEAL_ANSWER)

    val size: ReviewWidgetSize? = ReviewWidgetSize.entries.firstOrNull { entry -> entry.rawValue == rawSize }
    if (size == null) {
        Log.e(
            reviewWidgetLogTag,
            "domain=android_widget action=widget_tap_rejected reason=unsupported_widget_size widgetSize=$rawSize"
        )
        return null
    }
    val kind: WidgetKind? = if (rawKind == null) {
        WidgetKind.REVIEW
    } else {
        WidgetKind.entries.firstOrNull { entry -> entry.rawValue == rawKind }
    }
    if (kind == null) {
        Log.e(
            reviewWidgetLogTag,
            "domain=android_widget action=widget_tap_rejected reason=unsupported_widget_kind widgetKind=$rawKind"
        )
        return null
    }

    return ReviewWidgetTapRequest(
        destination = destination,
        workspaceId = workspaceId,
        size = size,
        kind = kind,
        cardId = cardId,
        revealAnswer = revealAnswer
    )
}
