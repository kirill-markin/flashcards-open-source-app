package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.content.Intent
import com.flashcardsopensourceapp.app.MainHostActivity

enum class ReviewWidgetSize(val rawValue: String) {
    SMALL(rawValue = "small"),
    MEDIUM(rawValue = "medium"),
    LARGE(rawValue = "large")
}

/** Every Home Screen widget kind the app places; the raw values are the `widget_kind` analytics values. */
enum class WidgetKind(val rawValue: String) {
    REVIEW(rawValue = "review"),
    ACTIVITY(rawValue = "activity"),
    YEAR(rawValue = "year"),
    TODAY(rawValue = "today"),
    REVIEWS_CHART(rawValue = "reviews_chart"),
    STREAKS(rawValue = "streaks"),
    MONTH_CALENDAR(rawValue = "month_calendar"),
    COMING_UP(rawValue = "coming_up"),
    DASHBOARD(rawValue = "dashboard")
}

/**
 * The Intents a Home Screen widget tap starts. The action markers keep a widget tap distinct from a
 * launcher or reminder-notification launch of the same activity. A tap without [EXTRA_WIDGET_KIND]
 * comes from a Review widget rendered before the extra existed.
 */
object ReviewWidgetTapContract {
    const val ACTION_OPEN_REVIEW: String = "com.flashcardsopensourceapp.app.widget.action.OPEN_REVIEW"
    const val ACTION_OPEN_PROGRESS: String = "com.flashcardsopensourceapp.app.widget.action.OPEN_PROGRESS"
    const val EXTRA_WIDGET_WORKSPACE_ID: String = "com.flashcardsopensourceapp.app.widget.extra.WORKSPACE_ID"
    const val EXTRA_WIDGET_SIZE: String = "com.flashcardsopensourceapp.app.widget.extra.SIZE"
    const val EXTRA_WIDGET_KIND: String = "com.flashcardsopensourceapp.app.widget.extra.KIND"
    const val EXTRA_WIDGET_CARD_ID: String = "com.flashcardsopensourceapp.app.widget.extra.CARD_ID"

    /**
     * [workspaceId] is null when the widget had no data yet; [cardId] is the card the tapped widget
     * showed, or null when it showed none.
     */
    fun makeOpenReviewIntent(
        context: Context,
        workspaceId: String?,
        size: ReviewWidgetSize,
        kind: WidgetKind,
        cardId: String?
    ): Intent {
        return makeWidgetTapIntent(context = context, action = ACTION_OPEN_REVIEW, size = size, kind = kind).apply {
            if (workspaceId != null) {
                putExtra(EXTRA_WIDGET_WORKSPACE_ID, workspaceId)
            }
            if (cardId != null) {
                putExtra(EXTRA_WIDGET_CARD_ID, cardId)
            }
        }
    }

    fun makeOpenProgressIntent(
        context: Context,
        size: ReviewWidgetSize,
        kind: WidgetKind
    ): Intent {
        return makeWidgetTapIntent(context = context, action = ACTION_OPEN_PROGRESS, size = size, kind = kind)
    }

    private fun makeWidgetTapIntent(
        context: Context,
        action: String,
        size: ReviewWidgetSize,
        kind: WidgetKind
    ): Intent {
        return Intent(context, MainHostActivity::class.java).apply {
            this.action = action
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_WIDGET_SIZE, size.rawValue)
            putExtra(EXTRA_WIDGET_KIND, kind.rawValue)
        }
    }
}
