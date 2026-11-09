package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.Scaffold
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import kotlinx.coroutines.flow.first

private val todayWidgetSmallSize = DpSize(width = 100.dp, height = 100.dp)
private val todayWidgetMediumSize = DpSize(width = 220.dp, height = 100.dp)
internal val todayWidgetSizes: Set<DpSize> = setOf(todayWidgetSmallSize, todayWidgetMediumSize)
/** The ring bitmap is drawn at the small widget's minimum size and scaled down to fit the space left. */
private val todayWidgetRingBitmapSize = DpSize(width = 100.dp, height = 100.dp)
private const val TODAY_WIDGET_RING_STROKE_FRACTION: Float = 0.1f
private val todayWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)

/** Today's reviews against the cards still due now, the Review badge count. */
private data class TodayWidgetProgress(
    val reviewedCount: Int,
    val leftCount: Int,
    val streakDays: Int
) {
    val totalCount: Int = reviewedCount + leftCount
    val fraction: Float = if (totalCount == 0) 0f else reviewedCount.toFloat() / totalCount
}

class TodayWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(sizes = todayWidgetSizes)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val content by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = todayWidgetColors) {
                TodayWidgetBody(content = content, size = todayWidgetSize(size = LocalSize.current))
            }
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

internal fun todayWidgetSize(size: DpSize): ReviewWidgetSize {
    return if (size == todayWidgetMediumSize) ReviewWidgetSize.MEDIUM else ReviewWidgetSize.SMALL
}

private fun makeTodayWidgetProgress(queue: ReviewWidgetContent, progress: WidgetProgressContent): TodayWidgetProgress {
    val today: WidgetProgressDay = checkNotNull(progress.days.lastOrNull { day -> day.localDate == progress.todayLocalDate }) {
        "Widget progress days ${progress.days.firstOrNull()?.localDate}..${progress.days.lastOrNull()?.localDate} " +
            "have no entry for today ${progress.todayLocalDate}."
    }
    return TodayWidgetProgress(
        reviewedCount = today.reviewCount,
        leftCount = queue.dueCount,
        streakDays = progress.currentStreakDays
    )
}

@Composable
private fun TodayWidgetBody(content: WidgetContent, size: ReviewWidgetSize) {
    val context = LocalContext.current
    val queue: ReviewWidgetContent? = content.queue
    val progress: WidgetProgressContent? = content.progress
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                    context = context,
                    workspaceId = queue?.workspaceId,
                    size = size,
                    kind = WidgetKind.TODAY,
                    cardId = null
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = 12.dp)) {
            if (queue == null || progress == null) {
                TodayWidgetOpenApp()
            } else {
                val todayProgress = makeTodayWidgetProgress(queue = queue, progress = progress)
                when (size) {
                    ReviewWidgetSize.SMALL -> TodayWidgetSmall(progress = todayProgress)
                    ReviewWidgetSize.MEDIUM, ReviewWidgetSize.LARGE -> TodayWidgetMedium(progress = todayProgress)
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.TodayWidgetOpenApp() {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.app_name),
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold),
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
private fun ColumnScope.TodayWidgetSmall(progress: TodayWidgetProgress) {
    val context = LocalContext.current
    Box(
        modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
        contentAlignment = Alignment.Center
    ) {
        Image(
            provider = ImageProvider(bitmap = makeTodayWidgetRingBitmap(context = context, fraction = progress.fraction)),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = GlanceModifier.fillMaxSize()
        )
        if (progress.totalCount > 0) {
            Text(
                text = context.getString(R.string.today_widget_count, progress.reviewedCount),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
        }
    }
    Spacer(modifier = GlanceModifier.height(2.dp))
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = todayWidgetFinishedText(context = context, progress = progress)
                ?: context.resources.getQuantityString(R.plurals.today_widget_left, progress.leftCount, progress.leftCount),
            style = secondaryStyle(),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight()
        )
        TodayWidgetStreakFlame(progress = progress, iconSize = 14.dp)
        Text(
            text = context.getString(R.string.today_widget_count, progress.streakDays),
            style = secondaryStyle(),
            maxLines = 1
        )
    }
}

@Composable
private fun ColumnScope.TodayWidgetMedium(progress: TodayWidgetProgress) {
    val context = LocalContext.current
    Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
            Text(
                text = context.getString(R.string.today_widget_label),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
            Text(
                text = context.resources.getQuantityString(
                    R.plurals.today_widget_reviewed,
                    progress.reviewedCount,
                    progress.reviewedCount
                ),
                style = secondaryStyle(),
                maxLines = 1
            )
            Spacer(modifier = GlanceModifier.defaultWeight())
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                LinearProgressIndicator(
                    progress = progress.fraction,
                    modifier = GlanceModifier.defaultWeight().height(6.dp),
                    color = GlanceTheme.colors.primary,
                    backgroundColor = GlanceTheme.colors.surfaceVariant
                )
                Spacer(modifier = GlanceModifier.width(8.dp))
                Text(
                    text = context.getString(R.string.today_widget_percent, (progress.fraction * 100).toInt()),
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp, fontWeight = FontWeight.Bold),
                    maxLines = 1
                )
            }
            Spacer(modifier = GlanceModifier.defaultWeight())
            Text(
                text = todayWidgetFinishedText(context = context, progress = progress)
                    ?: context.resources.getQuantityString(
                        R.plurals.today_widget_cards_left,
                        progress.leftCount,
                        progress.leftCount
                    ),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp),
                maxLines = 1
            )
        }
        Spacer(modifier = GlanceModifier.width(12.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            TodayWidgetStreakFlame(progress = progress, iconSize = 24.dp)
            Text(
                text = context.getString(R.string.today_widget_count, progress.streakDays),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
        }
    }
}

/** The flame is in the accent color once the user has reviewed today, as on the Review top bar. */
@Composable
private fun TodayWidgetStreakFlame(progress: TodayWidgetProgress, iconSize: Dp) {
    val context = LocalContext.current
    val tint: ColorProvider = if (progress.reviewedCount > 0) GlanceTheme.colors.primary else GlanceTheme.colors.onSurfaceVariant
    Image(
        provider = ImageProvider(resId = R.drawable.widget_streak_flame),
        contentDescription = context.resources.getQuantityString(
            R.plurals.review_widget_streak_days,
            progress.streakDays,
            progress.streakDays
        ),
        colorFilter = ColorFilter.tint(colorProvider = tint),
        modifier = GlanceModifier.size(iconSize)
    )
}

/** Null while cards are left; the caller then shows the left count in its own wording. */
private fun todayWidgetFinishedText(context: Context, progress: TodayWidgetProgress): String? {
    return when {
        progress.totalCount == 0 -> context.getString(R.string.today_widget_no_cards_due)
        progress.leftCount == 0 -> context.getString(R.string.review_widget_all_done)
        else -> null
    }
}

private fun makeTodayWidgetRingBitmap(context: Context, fraction: Float): Bitmap {
    val density: Float = context.resources.displayMetrics.density
    return drawWidgetBitmap(size = todayWidgetRingBitmapSize, density = density) { canvas ->
        drawWidgetProgressRing(
            canvas = canvas,
            fraction = fraction,
            strokeWidthPx = canvas.width * TODAY_WIDGET_RING_STROKE_FRACTION,
            trackColor = FlashcardsDarkColorScheme.surfaceVariant.toArgb(),
            progressColor = FlashcardsDarkColorScheme.primary.toArgb()
        )
    }
}

@Composable
private fun secondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
