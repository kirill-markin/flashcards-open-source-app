package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.DpSize
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
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import java.time.LocalDate
import kotlinx.coroutines.flow.first

private val yearWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)
/** The Scaffold's horizontal padding and the body's vertical padding. */
private val yearWidgetPadding = 12.dp
/** Height kept for the footer line and its spacer. */
private val yearWidgetFooterHeight = 24.dp

class YearWidget : GlanceAppWidget() {
    /**
     * Exact, so the grid bitmap is drawn at the real widget size instead of being scaled up from a
     * bucket. The Year view has only a large layout; `year_widget_info.xml` keeps it from being
     * resized smaller.
     */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetProgressContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val progress by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = yearWidgetColors) {
                YearWidgetBody(progress = progress, layoutSize = LocalSize.current)
            }
        }
    }
}

class YearWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = YearWidget()
}

@Composable
private fun YearWidgetBody(progress: WidgetProgressContent?, layoutSize: DpSize) {
    val context = LocalContext.current
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenProgressIntent(
                    context = context,
                    size = ReviewWidgetSize.LARGE,
                    kind = WidgetKind.YEAR
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = yearWidgetPadding)) {
            if (progress == null) {
                ReviewWidgetOpenApp()
            } else {
                YearWidgetMonths(progress = progress, layoutSize = layoutSize)
            }
        }
    }
}

@Composable
private fun ColumnScope.YearWidgetMonths(progress: WidgetProgressContent, layoutSize: DpSize) {
    val context = LocalContext.current
    val historyDates: Set<LocalDate> = progress.days.map { day -> day.localDate }.toSet()
    val reviewCount: Int = sumReviewCounts(progress = progress, dates = historyDates)
    val activeDayCount: Int = countActiveDays(progress = progress, dates = historyDates)
    Image(
        provider = ImageProvider(
            bitmap = drawYearBitmap(
                progress = progress,
                months = yearMonthDates(progress = progress),
                areaSize = DpSize(
                    width = layoutSize.width - yearWidgetPadding * 2,
                    height = layoutSize.height - yearWidgetPadding * 2 - yearWidgetFooterHeight
                ),
                density = context.resources.displayMetrics.density
            )
        ),
        contentDescription = context.getString(R.string.year_widget_grid_description),
        contentScale = ContentScale.Fit,
        modifier = GlanceModifier.fillMaxWidth().defaultWeight()
    )
    Spacer(modifier = GlanceModifier.height(6.dp))
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(
            text = context.resources.getQuantityString(R.plurals.activity_widget_reviews, reviewCount, reviewCount),
            style = yearSecondaryStyle(),
            maxLines = 1
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Text(
            text = context.resources.getQuantityString(R.plurals.year_widget_active_days, activeDayCount, activeDayCount),
            style = yearSecondaryStyle(),
            maxLines = 1
        )
    }
}

@Composable
private fun yearSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
