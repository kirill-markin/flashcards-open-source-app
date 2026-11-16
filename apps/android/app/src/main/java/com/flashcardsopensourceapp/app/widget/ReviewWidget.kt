package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.Scaffold
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.R
import java.util.Calendar

private val reviewWidgetSmallSize = DpSize(width = 100.dp, height = 100.dp)
private val reviewWidgetMediumSize = DpSize(width = 220.dp, height = 100.dp)
private val reviewWidgetLargeSize = DpSize(width = 220.dp, height = 220.dp)
internal val reviewWidgetSizes: Set<DpSize> = setOf(reviewWidgetSmallSize, reviewWidgetMediumSize, reviewWidgetLargeSize)

class ReviewWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(sizes = reviewWidgetSizes)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeReviewWidgetContent) { content ->
            ReviewWidgetBody(content = content, size = reviewWidgetSize(size = LocalSize.current))
        }
    }
}

class ReviewWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReviewWidget()
}

internal fun reviewWidgetSize(size: DpSize): ReviewWidgetSize {
    return when (size) {
        reviewWidgetLargeSize -> ReviewWidgetSize.LARGE
        reviewWidgetMediumSize -> ReviewWidgetSize.MEDIUM
        else -> ReviewWidgetSize.SMALL
    }
}

@Composable
private fun ReviewWidgetBody(content: ReviewWidgetContent?, size: ReviewWidgetSize) {
    val context = LocalContext.current
    val shownCard: ReviewWidgetCard? = when (size) {
        ReviewWidgetSize.SMALL -> null
        ReviewWidgetSize.MEDIUM, ReviewWidgetSize.LARGE -> content?.nextCard?.takeIf { content.dueCount > 0 }
    }
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                    context = context,
                    workspaceId = content?.workspaceId,
                    size = size,
                    kind = WidgetKind.REVIEW,
                    cardId = shownCard?.cardId,
                    revealAnswer = false
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = 12.dp)) {
            when {
                content == null -> ReviewWidgetOpenApp()
                content.dueCount == 0 -> ReviewWidgetAllDone(content = content, showStreak = size != ReviewWidgetSize.MEDIUM)
                size == ReviewWidgetSize.SMALL -> ReviewWidgetSmallDue(content = content)
                size == ReviewWidgetSize.MEDIUM -> ReviewWidgetMediumDue(content = content, card = shownCard)
                else -> ReviewWidgetLargeDue(content = content, card = shownCard)
            }
        }
    }
}

@Composable
internal fun ColumnScope.ReviewWidgetOpenApp() {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.app_name),
        style = titleStyle(),
        maxLines = 2
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.review_widget_open_app_message),
        style = secondaryStyle(),
        maxLines = 3
    )
}

@Composable
private fun ColumnScope.ReviewWidgetAllDone(content: ReviewWidgetContent, showStreak: Boolean) {
    val context = LocalContext.current
    Text(text = context.getString(R.string.review_widget_all_done), style = titleStyle(), maxLines = 1)
    val nextDueAtMillis = content.nextDueAtMillis
    if (nextDueAtMillis != null) {
        Spacer(modifier = GlanceModifier.height(4.dp))
        Text(
            text = context.getString(
                R.string.review_widget_next_due,
                formatReviewWidgetDueTime(context = context, dueAtMillis = nextDueAtMillis)
            ),
            style = secondaryStyle(),
            maxLines = 2
        )
    }
    if (showStreak) {
        ReviewWidgetStreakFooter(streakDays = content.streakDays)
    }
}

/** The cards to review, how many of them are due, and the streak. */
@Composable
private fun ColumnScope.ReviewWidgetSmallDue(content: ReviewWidgetContent) {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.review_widget_due_count, content.dueCount),
        // Smaller than a lone headline, so the due line fits under it.
        style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 34.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    Text(text = context.getString(R.string.review_widget_to_review_label), style = secondaryStyle(), maxLines = 1)
    Text(
        text = widgetScheduledDueText(context = context, scheduledDueCount = content.scheduledDueCount),
        style = secondaryStyle(),
        maxLines = 1
    )
    ReviewWidgetStreakFooter(streakDays = content.streakDays)
}

/** The cards to review, the next question, the due line with its minutes, and Reveal answer. */
@Composable
private fun ColumnScope.ReviewWidgetMediumDue(content: ReviewWidgetContent, card: ReviewWidgetCard?) {
    val context = LocalContext.current
    Text(
        text = context.resources.getQuantityString(R.plurals.review_widget_to_review_count, content.dueCount, content.dueCount),
        style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    if (card != null) {
        Spacer(modifier = GlanceModifier.height(4.dp))
        ReviewWidgetQuestion(card = card, maxLines = 3, modifier = GlanceModifier.defaultWeight())
    } else {
        Spacer(modifier = GlanceModifier.defaultWeight())
    }
    ReviewWidgetDueRow(content = content, card = card)
}

/** The cards to review with the streak, the due line with its minutes and the new count, the question, and Reveal answer. */
@Composable
private fun ColumnScope.ReviewWidgetLargeDue(content: ReviewWidgetContent, card: ReviewWidgetCard?) {
    val context = LocalContext.current
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = context.resources.getQuantityString(R.plurals.review_widget_to_review_count, content.dueCount, content.dueCount),
            style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 14.sp, fontWeight = FontWeight.Bold),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight()
        )
        val streakDays: Int? = content.streakDays
        if (streakDays != null) {
            Text(
                text = context.resources.getQuantityString(R.plurals.review_widget_streak_days, streakDays, streakDays),
                style = secondaryStyle(),
                maxLines = 1
            )
        }
    }
    val newCountDetail: List<String> = if (content.newCount > 0) {
        listOf(context.resources.getQuantityString(R.plurals.widget_new_count, content.newCount, content.newCount))
    } else {
        emptyList()
    }
    Text(
        text = joinWidgetDetails(details = widgetScheduledDueDetails(context = context, content = content) + newCountDetail),
        style = secondaryStyle(),
        maxLines = 1
    )
    if (card == null) {
        return
    }
    Spacer(modifier = GlanceModifier.height(8.dp))
    ReviewWidgetQuestion(card = card, maxLines = 6, modifier = GlanceModifier.defaultWeight())
    Spacer(modifier = GlanceModifier.height(8.dp))
    WidgetRevealAnswerButton(
        workspaceId = content.workspaceId,
        cardId = card.cardId,
        size = ReviewWidgetSize.LARGE,
        kind = WidgetKind.REVIEW,
        modifier = GlanceModifier
    )
}

/** The question area; its tap is the widget's, which opens the card question-side. */
@Composable
internal fun ReviewWidgetQuestion(card: ReviewWidgetCard, maxLines: Int, modifier: GlanceModifier) {
    val context = LocalContext.current
    Text(
        text = card.frontPlainText.ifBlank { context.getString(R.string.review_widget_question_without_text) },
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Medium),
        maxLines = maxLines,
        modifier = modifier
    )
}

/** The due line beside Reveal answer, which shows only with a card. */
@Composable
private fun ReviewWidgetDueRow(content: ReviewWidgetContent, card: ReviewWidgetCard?) {
    val context = LocalContext.current
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = joinWidgetDetails(details = widgetScheduledDueDetails(context = context, content = content)),
            style = secondaryStyle(),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight()
        )
        if (card != null) {
            Spacer(modifier = GlanceModifier.width(8.dp))
            WidgetRevealAnswerButton(
                workspaceId = content.workspaceId,
                cardId = card.cardId,
                size = ReviewWidgetSize.MEDIUM,
                kind = WidgetKind.REVIEW,
                modifier = GlanceModifier
            )
        }
    }
}

@Composable
private fun ColumnScope.ReviewWidgetStreakFooter(streakDays: Int?) {
    if (streakDays == null) {
        return
    }
    val context = LocalContext.current
    Spacer(modifier = GlanceModifier.defaultWeight())
    Text(
        text = context.resources.getQuantityString(R.plurals.review_widget_streak_days, streakDays, streakDays),
        style = secondaryStyle(),
        maxLines = 1
    )
}

@Composable
private fun titleStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun secondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}

/** Time in the user's 12/24-hour setting, with the date when not today and the year when not this year. */
internal fun formatReviewWidgetDueTime(context: Context, dueAtMillis: Long): String {
    if (DateUtils.isToday(dueAtMillis)) {
        return DateUtils.formatDateTime(context, dueAtMillis, DateUtils.FORMAT_SHOW_TIME)
    }
    val yearFlag = if (isInCurrentYear(timeMillis = dueAtMillis)) DateUtils.FORMAT_NO_YEAR else DateUtils.FORMAT_SHOW_YEAR
    return DateUtils.formatDateTime(
        context,
        dueAtMillis,
        DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH or yearFlag
    )
}

private fun isInCurrentYear(timeMillis: Long): Boolean {
    val now = Calendar.getInstance()
    val then = Calendar.getInstance().apply { this.timeInMillis = timeMillis }
    return then.get(Calendar.YEAR) == now.get(Calendar.YEAR)
}
