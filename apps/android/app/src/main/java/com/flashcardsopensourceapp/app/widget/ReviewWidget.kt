package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import java.util.Calendar

private val reviewWidgetSmallSize = DpSize(width = 100.dp, height = 100.dp)
private val reviewWidgetMediumSize = DpSize(width = 220.dp, height = 100.dp)
private val reviewWidgetLargeSize = DpSize(width = 220.dp, height = 220.dp)
private val reviewWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)

class ReviewWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(
        sizes = setOf(reviewWidgetSmallSize, reviewWidgetMediumSize, reviewWidgetLargeSize)
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeCurrentGraphReviewWidgetContent(
            application = context.applicationContext as FlashcardsApplication
        )
        val initialContent = contentFlow.first()
        provideContent {
            val content by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = reviewWidgetColors) {
                ReviewWidgetBody(content = content, size = reviewWidgetSize(size = LocalSize.current))
            }
        }
    }
}

class ReviewWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReviewWidget()
}

/** Follows graph replacement (sign-out, reset) and waits while no graph is published. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun observeCurrentGraphReviewWidgetContent(
    application: FlashcardsApplication
): Flow<ReviewWidgetContent?> {
    return application.appGraphState.flatMapLatest { appGraph ->
        if (appGraph == null) emptyFlow() else observeReviewWidgetContent(appGraph = appGraph)
    }
}

private fun reviewWidgetSize(size: DpSize): ReviewWidgetSize {
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
                intent = ReviewWidgetTapContract.makeIntent(
                    context = context,
                    workspaceId = content?.workspaceId,
                    size = size,
                    cardId = shownCard?.cardId
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = 12.dp)) {
            when {
                content == null -> ReviewWidgetOpenApp()
                content.dueCount == 0 -> ReviewWidgetAllDone(content = content, showStreak = size != ReviewWidgetSize.MEDIUM)
                size == ReviewWidgetSize.SMALL -> ReviewWidgetSmallDue(content = content)
                else -> ReviewWidgetDueWithCard(
                    content = content,
                    card = shownCard,
                    showStreak = size == ReviewWidgetSize.LARGE
                )
            }
        }
    }
}

@Composable
private fun ColumnScope.ReviewWidgetOpenApp() {
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

@Composable
private fun ColumnScope.ReviewWidgetSmallDue(content: ReviewWidgetContent) {
    val context = LocalContext.current
    Text(
        text = content.dueCount.toString(),
        style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 40.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    Text(text = context.getString(R.string.review_widget_due_label), style = secondaryStyle(), maxLines = 1)
    ReviewWidgetStreakFooter(streakDays = content.streakDays)
}

@Composable
private fun ColumnScope.ReviewWidgetDueWithCard(content: ReviewWidgetContent, card: ReviewWidgetCard?, showStreak: Boolean) {
    val context = LocalContext.current
    Text(
        text = context.resources.getQuantityString(R.plurals.review_widget_cards_due, content.dueCount, content.dueCount),
        style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 14.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
    if (card != null) {
        Spacer(modifier = GlanceModifier.height(8.dp))
        Text(
            text = card.frontPlainText.ifBlank { context.getString(R.string.review_widget_question_without_text) },
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Medium),
            maxLines = if (showStreak) 6 else 3
        )
    }
    if (showStreak) {
        ReviewWidgetStreakFooter(streakDays = content.streakDays)
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
private fun formatReviewWidgetDueTime(context: Context, dueAtMillis: Long): String {
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
