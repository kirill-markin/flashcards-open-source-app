package com.flashcardsopensourceapp.app.widget

import android.content.Context
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
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import kotlinx.coroutines.flow.first

private const val streaksWidgetPastStreakLimit: Int = 4
/** The smallest widget that shows the medium layout; anything smaller shows the small one. */
private val streaksWidgetMediumMinSize = DpSize(width = 220.dp, height = 100.dp)
private val streaksWidgetHeaderFontSize: TextUnit = 14.sp
private val streaksWidgetHeaderSpacing: Dp = 4.dp
private val streaksWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)

class StreaksWidget : GlanceAppWidget() {
    /** Exact, so [LocalSize] is the real widget size and the chart bitmap is drawn at it, never upscaled. */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetProgressContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val content by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = streaksWidgetColors) {
                StreaksWidgetBody(content = content, widgetSize = LocalSize.current)
            }
        }
    }
}

class StreaksWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = StreaksWidget()
}

internal fun streaksWidgetSize(widgetSize: DpSize): ReviewWidgetSize {
    val fitsMedium: Boolean = widgetSize.width >= streaksWidgetMediumMinSize.width &&
        widgetSize.height >= streaksWidgetMediumMinSize.height
    return if (fitsMedium) ReviewWidgetSize.MEDIUM else ReviewWidgetSize.SMALL
}

@Composable
private fun StreaksWidgetBody(content: WidgetProgressContent?, widgetSize: DpSize) {
    val context = LocalContext.current
    val size: ReviewWidgetSize = streaksWidgetSize(widgetSize = widgetSize)
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        horizontalPadding = widgetContentPadding,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenProgressIntent(
                    context = context,
                    size = size,
                    kind = WidgetKind.STREAKS
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = widgetContentPadding)) {
            when {
                content == null -> StreaksWidgetOpenApp()
                size == ReviewWidgetSize.MEDIUM -> StreaksWidgetMedium(content = content, widgetSize = widgetSize)
                else -> StreaksWidgetSmall(content = content)
            }
        }
    }
}

@Composable
private fun ColumnScope.StreaksWidgetOpenApp() {
    val context = LocalContext.current
    Text(text = context.getString(R.string.app_name), style = streaksTitleStyle(), maxLines = 2)
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.review_widget_open_app_message),
        style = streaksSecondaryStyle(),
        maxLines = 3
    )
}

@Composable
private fun ColumnScope.StreaksWidgetSmall(content: WidgetProgressContent) {
    val context = LocalContext.current
    val dayCountText: String = context.getString(R.string.streaks_widget_day_count, content.currentStreakDays)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text = context.getString(R.string.streaks_widget_flame), style = TextStyle(fontSize = 20.sp), maxLines = 1)
        Spacer(modifier = GlanceModifier.width(4.dp))
        Text(
            text = dayCountText,
            style = TextStyle(
                color = GlanceTheme.colors.primary,
                fontSize = streaksSmallDayCountFontSize(digitCount = dayCountText.length),
                fontWeight = FontWeight.Bold
            ),
            maxLines = 1
        )
    }
    Spacer(modifier = GlanceModifier.defaultWeight())
    Text(
        text = context.getString(R.string.streaks_widget_best, content.longestStreakDays),
        style = streaksSmallSecondaryStyle(),
        maxLines = 1
    )
    Text(
        text = context.getString(R.string.streaks_widget_freeze_credits, content.availableFreezeCredits),
        style = streaksSmallSecondaryStyle(),
        maxLines = 1
    )
}

/** The flame and the count share the small widget's content width, 76dp at its narrowest, so longer counts shrink. */
private fun streaksSmallDayCountFontSize(digitCount: Int): TextUnit {
    return when {
        digitCount <= 2 -> 30.sp
        digitCount == 3 -> 24.sp
        else -> 19.sp
    }
}

/** Smaller than the medium's, so both lines stay under the count at a larger system font. */
@Composable
private fun streaksSmallSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp)
}

@Composable
private fun ColumnScope.StreaksWidgetMedium(content: WidgetProgressContent, widgetSize: DpSize) {
    val context = LocalContext.current
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = context.getString(R.string.streaks_widget_label),
            style = TextStyle(
                color = GlanceTheme.colors.primary,
                fontSize = streaksWidgetHeaderFontSize,
                fontWeight = FontWeight.Bold
            ),
            maxLines = 1
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Text(
            text = context.getString(R.string.streaks_widget_best, content.longestStreakDays),
            style = streaksSecondaryStyle(),
            maxLines = 1
        )
    }
    val streakRuns: List<WidgetStreakRun> = makeWidgetStreakRuns(
        content = content,
        pastRunLimit = streaksWidgetPastStreakLimit
    )
    if (streakRuns.isEmpty()) {
        Spacer(modifier = GlanceModifier.height(8.dp))
        Text(text = context.getString(R.string.streaks_widget_empty), style = streaksSecondaryStyle(), maxLines = 2)
        return
    }
    Spacer(modifier = GlanceModifier.height(streaksWidgetHeaderSpacing))
    Image(
        provider = ImageProvider(
            bitmap = drawStreakBarsBitmap(
                context = context,
                runs = streakRuns,
                size = widgetImageSize(
                    context = context,
                    widgetSize = widgetSize,
                    headerFontSize = streaksWidgetHeaderFontSize,
                    headerSpacing = streaksWidgetHeaderSpacing
                )
            )
        ),
        contentDescription = context.getString(R.string.streaks_widget_chart_description),
        modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
        contentScale = ContentScale.Fit
    )
}

@Composable
private fun streaksTitleStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun streaksSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
