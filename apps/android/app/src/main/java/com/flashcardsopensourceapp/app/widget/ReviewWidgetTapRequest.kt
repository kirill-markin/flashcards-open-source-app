package com.flashcardsopensourceapp.app.widget

import android.content.Intent
import android.util.Log
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsWidgetSize

data class ReviewWidgetTapRequest(
    val workspaceId: String?,
    val size: ReviewWidgetSize,
    val cardId: String?
)

fun analyticsWidgetSize(size: ReviewWidgetSize): AnalyticsWidgetSize {
    return when (size) {
        ReviewWidgetSize.SMALL -> AnalyticsWidgetSize.SMALL
        ReviewWidgetSize.MEDIUM -> AnalyticsWidgetSize.MEDIUM
        ReviewWidgetSize.LARGE -> AnalyticsWidgetSize.LARGE
    }
}

private const val reviewWidgetLogTag: String = "FlashcardsReviewWidget"

/**
 * The widget tap [intent] carries, or null for any other launch. The tap is cleared from [intent], so
 * a configuration change that re-delivers the same intent does not report it twice.
 */
fun consumeReviewWidgetTapRequest(intent: Intent): ReviewWidgetTapRequest? {
    if (intent.action != ReviewWidgetTapContract.ACTION) {
        return null
    }
    val rawSize: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_SIZE)
    val workspaceId: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_WORKSPACE_ID)
    val cardId: String? = intent.getStringExtra(ReviewWidgetTapContract.EXTRA_WIDGET_CARD_ID)
    intent.action = null
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_SIZE)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_WORKSPACE_ID)
    intent.removeExtra(ReviewWidgetTapContract.EXTRA_WIDGET_CARD_ID)

    val size: ReviewWidgetSize? = ReviewWidgetSize.entries.firstOrNull { entry -> entry.rawValue == rawSize }
    if (size == null) {
        Log.e(
            reviewWidgetLogTag,
            "domain=android_widget action=widget_tap_rejected reason=unsupported_widget_size widgetSize=$rawSize"
        )
        return null
    }

    return ReviewWidgetTapRequest(
        workspaceId = workspaceId,
        size = size,
        cardId = cardId
    )
}
