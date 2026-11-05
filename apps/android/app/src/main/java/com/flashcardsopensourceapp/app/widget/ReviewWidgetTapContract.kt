package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.content.Intent
import com.flashcardsopensourceapp.app.MainHostActivity

enum class ReviewWidgetSize(val rawValue: String) {
    SMALL(rawValue = "small"),
    MEDIUM(rawValue = "medium"),
    LARGE(rawValue = "large")
}

/**
 * The Intent a Home Screen widget tap starts. The [ACTION] marker keeps a widget tap distinct from a
 * launcher or reminder-notification launch of the same activity.
 */
object ReviewWidgetTapContract {
    const val ACTION: String = "com.flashcardsopensourceapp.app.widget.action.OPEN_REVIEW"
    const val EXTRA_WIDGET_WORKSPACE_ID: String = "com.flashcardsopensourceapp.app.widget.extra.WORKSPACE_ID"
    const val EXTRA_WIDGET_SIZE: String = "com.flashcardsopensourceapp.app.widget.extra.SIZE"
    const val EXTRA_WIDGET_CARD_ID: String = "com.flashcardsopensourceapp.app.widget.extra.CARD_ID"

    /**
     * [workspaceId] is null when the widget had no data yet; [cardId] is the card the tapped widget
     * showed, or null when it showed none.
     */
    fun makeIntent(
        context: Context,
        workspaceId: String?,
        size: ReviewWidgetSize,
        cardId: String?
    ): Intent {
        return Intent(context, MainHostActivity::class.java).apply {
            action = ACTION
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (workspaceId != null) {
                putExtra(EXTRA_WIDGET_WORKSPACE_ID, workspaceId)
            }
            putExtra(EXTRA_WIDGET_SIZE, size.rawValue)
            if (cardId != null) {
                putExtra(EXTRA_WIDGET_CARD_ID, cardId)
            }
        }
    }
}
