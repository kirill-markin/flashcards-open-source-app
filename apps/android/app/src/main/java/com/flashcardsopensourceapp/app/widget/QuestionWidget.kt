package com.flashcardsopensourceapp.app.widget

import android.content.Context
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
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

private val questionWidgetSmallSize = DpSize(width = 100.dp, height = 100.dp)
private val questionWidgetMediumSize = DpSize(width = 220.dp, height = 100.dp)
private val questionWidgetLargeSize = DpSize(width = 220.dp, height = 220.dp)
internal val questionWidgetSizes: Set<DpSize> = setOf(questionWidgetSmallSize, questionWidgetMediumSize, questionWidgetLargeSize)
/** The local hours a new question takes the widget; the last slot runs past midnight until the first. */
private val questionWidgetRotationHours: List<Int> = listOf(6, 12, 16, 20)

/**
 * A question from the saved filter's next cards, rotating at [questionWidgetRotationHours]; the rotation
 * follows the time of each render, which happens on every data change and every 30 minutes.
 */
class QuestionWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(sizes = questionWidgetSizes)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeReviewWidgetContent) { content ->
            QuestionWidgetBody(content = content, size = questionWidgetSize(size = LocalSize.current))
        }
    }
}

class QuestionWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuestionWidget()
}

internal fun questionWidgetSize(size: DpSize): ReviewWidgetSize {
    return when (size) {
        questionWidgetLargeSize -> ReviewWidgetSize.LARGE
        questionWidgetMediumSize -> ReviewWidgetSize.MEDIUM
        else -> ReviewWidgetSize.SMALL
    }
}

/** The card for the rotation slot [now] falls in; consecutive slots step through the cards in queue order. */
internal fun questionWidgetCard(cards: List<ReviewWidgetCard>, now: LocalDateTime): ReviewWidgetCard? {
    if (cards.isEmpty()) {
        return null
    }
    val slotsPerDay: Int = questionWidgetRotationHours.size
    val slotInDay: Int = questionWidgetRotationHours.indexOfLast { hour -> now.hour >= hour }
    // Before the first slot of a day, the previous day's last slot still runs.
    val slot: Long = if (slotInDay < 0) {
        now.toLocalDate().toEpochDay() * slotsPerDay - 1L
    } else {
        now.toLocalDate().toEpochDay() * slotsPerDay + slotInDay
    }
    return cards[Math.floorMod(slot, cards.size.toLong()).toInt()]
}

@Composable
private fun QuestionWidgetBody(content: ReviewWidgetContent?, size: ReviewWidgetSize) {
    val context = LocalContext.current
    val shownCard: ReviewWidgetCard? = content?.takeIf { queue -> queue.dueCount > 0 }?.let { queue ->
        questionWidgetCard(cards = queue.nextCards, now = LocalDateTime.now().truncatedTo(ChronoUnit.MINUTES))
    }
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                    context = context,
                    workspaceId = content?.workspaceId,
                    size = size,
                    kind = WidgetKind.QUESTION,
                    cardId = shownCard?.cardId,
                    revealAnswer = false
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = 12.dp)) {
            when {
                content == null -> ReviewWidgetOpenApp()
                content.dueCount == 0 -> QuestionWidgetAllDone(content = content)
                shownCard == null -> QuestionWidgetNoCard(content = content)
                size == ReviewWidgetSize.SMALL -> QuestionWidgetSmall(content = content, card = shownCard)
                else -> QuestionWidgetWithDueCount(content = content, card = shownCard, size = size)
            }
        }
    }
}

/** The question and Reveal answer. */
@Composable
private fun ColumnScope.QuestionWidgetSmall(content: ReviewWidgetContent, card: ReviewWidgetCard) {
    ReviewWidgetQuestion(card = card, maxLines = 3, modifier = GlanceModifier.defaultWeight())
    Spacer(modifier = GlanceModifier.height(4.dp))
    WidgetRevealAnswerButton(
        workspaceId = content.workspaceId,
        cardId = card.cardId,
        size = ReviewWidgetSize.SMALL,
        kind = WidgetKind.QUESTION,
        modifier = GlanceModifier.fillMaxWidth()
    )
}

/** The question, then the cards due beside Reveal answer. */
@Composable
private fun ColumnScope.QuestionWidgetWithDueCount(content: ReviewWidgetContent, card: ReviewWidgetCard, size: ReviewWidgetSize) {
    val context = LocalContext.current
    ReviewWidgetQuestion(
        card = card,
        maxLines = if (size == ReviewWidgetSize.LARGE) 7 else 3,
        modifier = GlanceModifier.defaultWeight()
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = widgetScheduledDueText(context = context, scheduledDueCount = content.scheduledDueCount),
            style = questionSecondaryStyle(),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight()
        )
        Spacer(modifier = GlanceModifier.width(8.dp))
        WidgetRevealAnswerButton(
            workspaceId = content.workspaceId,
            cardId = card.cardId,
            size = size,
            kind = WidgetKind.QUESTION,
            modifier = GlanceModifier
        )
    }
}

/** Nothing to review: "All done" with the next due time when known, and no button. */
@Composable
private fun ColumnScope.QuestionWidgetAllDone(content: ReviewWidgetContent) {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.review_widget_all_done),
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    val nextDueAtMillis: Long? = content.nextDueAtMillis
    if (nextDueAtMillis != null) {
        Spacer(modifier = GlanceModifier.height(4.dp))
        Text(
            text = context.getString(
                R.string.review_widget_next_due,
                formatReviewWidgetDueTime(context = context, dueAtMillis = nextDueAtMillis)
            ),
            style = questionSecondaryStyle(),
            maxLines = 2
        )
    }
}

/** Cards to review, but none in the saved filter to show: the count, and no button. */
@Composable
private fun ColumnScope.QuestionWidgetNoCard(content: ReviewWidgetContent) {
    val context = LocalContext.current
    Text(
        text = context.resources.getQuantityString(R.plurals.review_widget_to_review_count, content.dueCount, content.dueCount),
        style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    Text(
        text = widgetScheduledDueText(context = context, scheduledDueCount = content.scheduledDueCount),
        style = questionSecondaryStyle(),
        maxLines = 1
    )
}

@Composable
private fun questionSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
