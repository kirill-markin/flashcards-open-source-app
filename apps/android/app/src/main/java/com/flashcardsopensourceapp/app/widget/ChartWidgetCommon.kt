package com.flashcardsopensourceapp.app.widget

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import android.util.DisplayMetrics
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.Scaffold
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
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
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme

/** The provider XML's minimum resize; neither widget has a Small layout. */
private val chartWidgetMinimumSize = DpSize(width = 220.dp, height = 100.dp)
private val chartWidgetLargeMinimumHeight = 220.dp
private val chartWidgetHorizontalPadding = 12.dp
private val chartWidgetVerticalPadding = 12.dp
private val chartWidgetLabelFontSize: TextUnit = 10.sp
internal val chartWidgetHeaderFontSize: TextUnit = 13.sp
internal val chartWidgetLegendFontSize: TextUnit = 11.sp
/** A line of chart labels never takes more than this share of the chart bitmap's height, so the bars keep the rest. */
internal const val chartWidgetMaxLabelHeightFraction: Float = 0.25f
/** A chart drops an optional header or legend part when that part would leave it shorter than this. */
internal val chartWidgetMinimumChartHeight: Dp = 48.dp

/**
 * Exact, not Responsive: [androidx.glance.LocalSize] is then the real widget size, so charts are drawn
 * at the size they are shown instead of being scaled up from a bucket.
 */
internal val chartWidgetSizeMode: SizeMode = SizeMode.Exact
internal val chartWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)

internal val chartWidgetPrimaryArgb: Int = FlashcardsDarkColorScheme.primary.toArgb()
internal val chartWidgetLabelArgb: Int = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
internal val chartWidgetTrackArgb: Int = FlashcardsDarkColorScheme.outlineVariant.toArgb()

internal fun chartWidgetSize(size: DpSize): ReviewWidgetSize {
    return if (size.height >= chartWidgetLargeMinimumHeight) ReviewWidgetSize.LARGE else ReviewWidgetSize.MEDIUM
}

/**
 * The bitmap size for a chart that fills the widget width and its height minus [reservedHeight] of text
 * and spacing, so it is shown 1:1. A launcher reporting less than the minimum resize gets the minimum
 * layout, scaled down to fit.
 */
internal fun chartWidgetBitmapSize(widgetSize: DpSize, reservedHeight: Dp): DpSize {
    return DpSize(
        width = maxOf(widgetSize.width, chartWidgetMinimumSize.width) - chartWidgetHorizontalPadding * 2,
        height = (maxOf(widgetSize.height, chartWidgetMinimumSize.height) - chartWidgetVerticalPadding * 2 - reservedHeight)
            .coerceAtLeast(1.dp)
    )
}

/**
 * Chart label text that follows the font scale, shrunk so the widest of [labels] fits [maxLabelWidth] px,
 * but not below its size at font scale 1.0, and so a line fits [maxLabelHeight] px, below that size if needed.
 */
internal fun makeChartWidgetLabelPaint(
    displayMetrics: DisplayMetrics,
    argb: Int,
    typeface: Typeface,
    labels: List<String>,
    maxLabelWidth: Float,
    maxLabelHeight: Float
): Paint {
    val scaledTextSize: Float = widgetTextSizePx(fontSize = chartWidgetLabelFontSize, displayMetrics = displayMetrics)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = argb
        this.typeface = typeface
        textSize = scaledTextSize
    }
    val widestLabelWidth: Float = labels.maxOf { label -> paint.measureText(label) }
    if (widestLabelWidth > maxLabelWidth) {
        paint.textSize = minOf(
            scaledTextSize,
            maxOf(scaledTextSize * maxLabelWidth / widestLabelWidth, chartWidgetLabelFontSize.value * displayMetrics.density)
        )
    }
    if (paint.fontSpacing > maxLabelHeight) {
        paint.textSize = paint.textSize * maxLabelHeight / paint.fontSpacing
    }
    return paint
}

/** The widget surface; a tap anywhere opens Progress. */
@Composable
internal fun ChartWidgetScaffold(size: ReviewWidgetSize, kind: WidgetKind, content: @Composable ColumnScope.() -> Unit) {
    val context = LocalContext.current
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        horizontalPadding = chartWidgetHorizontalPadding,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenProgressIntent(context = context, size = size, kind = kind)
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = chartWidgetVerticalPadding), content = content)
    }
}

/** Shown before the app has provided the data the widget draws. */
@Composable
internal fun ColumnScope.ChartWidgetOpenApp() {
    val context = LocalContext.current
    Text(text = context.getString(R.string.app_name), style = chartWidgetTitleStyle(), maxLines = 2)
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.review_widget_open_app_message),
        style = chartWidgetSecondaryStyle(),
        maxLines = 3
    )
}

@Composable
internal fun ColumnScope.ChartWidgetImage(bitmap: Bitmap) {
    Image(
        provider = ImageProvider(bitmap = bitmap),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = GlanceModifier.fillMaxWidth().defaultWeight()
    )
}

@Composable
internal fun ChartWidgetLegendItem(color: Color, label: String, count: String?, modifier: GlanceModifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = GlanceModifier.size(8.dp).background(ColorProvider(color = color))) {}
        Spacer(modifier = GlanceModifier.width(4.dp))
        Text(text = label, style = chartWidgetLegendStyle(), maxLines = 1, modifier = GlanceModifier.defaultWeight())
        if (count != null) {
            Spacer(modifier = GlanceModifier.width(4.dp))
            Text(
                text = count,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurface,
                    fontSize = chartWidgetLegendFontSize,
                    fontWeight = FontWeight.Medium
                ),
                maxLines = 1
            )
        }
    }
}

@Composable
internal fun chartWidgetTitleStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

@Composable
internal fun chartWidgetHeaderStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.primary, fontSize = chartWidgetHeaderFontSize, fontWeight = FontWeight.Bold)
}

@Composable
internal fun chartWidgetSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}

@Composable
internal fun chartWidgetLegendStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = chartWidgetLegendFontSize)
}
