package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.Scaffold
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.flow.first

/** The smallest widget that shows the large layout; anything smaller shows the small one. */
private val monthCalendarWidgetLargeMinSize = DpSize(width = 220.dp, height = 220.dp)
private val monthCalendarWidgetSmallTitleFontSize: TextUnit = 13.sp
private val monthCalendarWidgetLargeTitleFontSize: TextUnit = 16.sp
private val monthCalendarWidgetTitleSpacing: Dp = 4.dp
private val monthCalendarWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)

class MonthCalendarWidget : GlanceAppWidget() {
    /** Exact, so [LocalSize] is the real widget size and the grid bitmap is drawn at it, never upscaled. */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetProgressContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val content by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = monthCalendarWidgetColors) {
                MonthCalendarWidgetBody(content = content, widgetSize = LocalSize.current)
            }
        }
    }
}

class MonthCalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MonthCalendarWidget()
}

internal fun monthCalendarWidgetSize(widgetSize: DpSize): ReviewWidgetSize {
    val fitsLarge: Boolean = widgetSize.width >= monthCalendarWidgetLargeMinSize.width &&
        widgetSize.height >= monthCalendarWidgetLargeMinSize.height
    return if (fitsLarge) ReviewWidgetSize.LARGE else ReviewWidgetSize.SMALL
}

@Composable
private fun MonthCalendarWidgetBody(content: WidgetProgressContent?, widgetSize: DpSize) {
    val context = LocalContext.current
    val size: ReviewWidgetSize = monthCalendarWidgetSize(widgetSize = widgetSize)
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        horizontalPadding = widgetContentPadding,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenProgressIntent(
                    context = context,
                    size = size,
                    kind = WidgetKind.MONTH_CALENDAR
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = widgetContentPadding)) {
            when {
                content == null -> MonthCalendarWidgetOpenApp()
                size == ReviewWidgetSize.LARGE -> MonthCalendarWidgetLarge(content = content, widgetSize = widgetSize)
                else -> MonthCalendarWidgetSmall(content = content, widgetSize = widgetSize)
            }
        }
    }
}

@Composable
private fun ColumnScope.MonthCalendarWidgetOpenApp() {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.app_name),
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold),
        maxLines = 2
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.review_widget_open_app_message),
        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp),
        maxLines = 3
    )
}

@Composable
private fun ColumnScope.MonthCalendarWidgetSmall(content: WidgetProgressContent, widgetSize: DpSize) {
    val context = LocalContext.current
    Text(
        text = formatMonthCalendarTitle(context = context, content = content, skeleton = "LLLL"),
        style = TextStyle(
            color = GlanceTheme.colors.onSurface,
            fontSize = monthCalendarWidgetSmallTitleFontSize,
            fontWeight = FontWeight.Bold
        ),
        maxLines = 1
    )
    Spacer(modifier = GlanceModifier.height(monthCalendarWidgetTitleSpacing))
    val weeks: List<List<MonthCalendarCell?>> = makeMonthCalendarWeeks(content = content)
    MonthCalendarImage(
        weeks = weeks,
        bitmap = drawMonthCalendarDotsBitmap(
            context = context,
            weeks = weeks,
            size = widgetImageSize(
                context = context,
                widgetSize = widgetSize,
                headerFontSize = monthCalendarWidgetSmallTitleFontSize,
                headerSpacing = monthCalendarWidgetTitleSpacing
            )
        )
    )
}

@Composable
private fun ColumnScope.MonthCalendarWidgetLarge(content: WidgetProgressContent, widgetSize: DpSize) {
    val context = LocalContext.current
    Text(
        text = formatMonthCalendarTitle(context = context, content = content, skeleton = "LLLLyyyy"),
        style = TextStyle(
            color = GlanceTheme.colors.onSurface,
            fontSize = monthCalendarWidgetLargeTitleFontSize,
            fontWeight = FontWeight.Bold
        ),
        maxLines = 1
    )
    Spacer(modifier = GlanceModifier.height(monthCalendarWidgetTitleSpacing))
    val weeks: List<List<MonthCalendarCell?>> = makeMonthCalendarWeeks(content = content)
    MonthCalendarImage(
        weeks = weeks,
        bitmap = drawMonthCalendarDaysBitmap(
            context = context,
            weeks = weeks,
            firstDayOfWeek = content.firstDayOfWeek,
            size = widgetImageSize(
                context = context,
                widgetSize = widgetSize,
                headerFontSize = monthCalendarWidgetLargeTitleFontSize,
                headerSpacing = monthCalendarWidgetTitleSpacing
            )
        )
    )
}

@Composable
private fun ColumnScope.MonthCalendarImage(weeks: List<List<MonthCalendarCell?>>, bitmap: Bitmap) {
    val context = LocalContext.current
    val streakDayCount: Int = weeks.flatten().count { cell ->
        cell?.streakState?.let(::isStreakDayState) == true
    }
    Image(
        provider = ImageProvider(bitmap = bitmap),
        contentDescription = context.resources.getQuantityString(
            R.plurals.month_calendar_widget_chart_description,
            streakDayCount,
            streakDayCount
        ),
        modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
        contentScale = ContentScale.Fit
    )
}

private fun formatMonthCalendarTitle(context: Context, content: WidgetProgressContent, skeleton: String): String {
    val locale: Locale = context.resources.configuration.locales[0]
    return DateTimeFormatter
        .ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)
        .format(content.todayLocalDate)
}
