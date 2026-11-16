package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.FilledButton
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.repository.progress.estimateDueMinutes

/** Separates the short facts one widget line holds, such as "34 due · ≈ 6 min". */
private const val widgetDetailSeparator: String = " · "

/**
 * Opens Review on [cardId] answer-side. Every widget that shows a question carries it; the question
 * area keeps its own tap, which opens the card question-side.
 */
@Composable
internal fun WidgetRevealAnswerButton(
    workspaceId: String,
    cardId: String,
    size: ReviewWidgetSize,
    kind: WidgetKind,
    modifier: GlanceModifier
) {
    val context = LocalContext.current
    FilledButton(
        text = context.getString(R.string.widget_reveal_answer),
        onClick = actionStartActivity(
            intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                context = context,
                workspaceId = workspaceId,
                size = size,
                kind = kind,
                cardId = cardId,
                revealAnswer = true
            )
        ),
        modifier = modifier,
        maxLines = 1
    )
}

/** Minutes to clear the cards due by schedule; null at 0 due and without the server's timing sample. */
internal fun reviewWidgetDueMinutes(content: ReviewWidgetContent): Int? {
    return estimateDueMinutes(dueCount = content.scheduledDueCount, insights = content.insights)
}

/** "34 due", or "✓ 0 due" once only new cards are left. */
internal fun widgetScheduledDueText(context: Context, scheduledDueCount: Int): String {
    if (scheduledDueCount <= 0) {
        return context.getString(R.string.widget_scheduled_due_none)
    }
    return context.resources.getQuantityString(R.plurals.widget_scheduled_due, scheduledDueCount, scheduledDueCount)
}

internal fun widgetMinutesText(context: Context, minutes: Int): String {
    return context.resources.getQuantityString(R.plurals.widget_minutes_estimate, minutes, minutes)
}

/** The due count, then the minutes to clear it when known: "34 due", "≈ 6 min". */
internal fun widgetScheduledDueDetails(context: Context, content: ReviewWidgetContent): List<String> {
    return listOfNotNull(
        widgetScheduledDueText(context = context, scheduledDueCount = content.scheduledDueCount),
        reviewWidgetDueMinutes(content = content)?.let { minutes -> widgetMinutesText(context = context, minutes = minutes) }
    )
}

/** One widget line of short facts, for example "34 due · ≈ 6 min". */
internal fun joinWidgetDetails(details: List<String>): String {
    return details.joinToString(separator = widgetDetailSeparator)
}
