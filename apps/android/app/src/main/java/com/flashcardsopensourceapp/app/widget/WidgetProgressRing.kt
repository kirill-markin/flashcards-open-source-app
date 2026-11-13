package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.core.graphics.ColorUtils
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.fillMaxSize
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.repository.progress.ReviewPace
import com.flashcardsopensourceapp.data.local.repository.progress.reviewPaceMaximumRingLaps

/** How far the second lap's shade moves from the accent toward white, so it reads over the first lap. */
private const val widgetPaceRingSecondLapTint: Float = 0.45f
private const val widgetPaceRingStrokeFraction: Float = 0.1f
private val widgetPaceRingLabelFontSize: TextUnit = 10.sp

/**
 * The last 7 days' reviews with "7 days" under them, inside the pace ring. Without a pace baseline
 * the number stands alone, with no ring and no track. [bitmapSize] is the size the ring is drawn at
 * before it is fitted into [modifier]'s space.
 */
@Composable
internal fun WidgetPaceRing(pace: ReviewPace, bitmapSize: DpSize, numberFontSize: TextUnit, modifier: GlanceModifier) {
    val context = LocalContext.current
    val baseline = pace.baseline
    val accentArgb: Int = widgetAccentColor().toArgb()
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        if (baseline != null) {
            Image(
                provider = ImageProvider(
                    bitmap = makeWidgetPaceRingBitmap(
                        context = context,
                        ringProgress = baseline.ringProgress.toFloat(),
                        accentArgb = accentArgb,
                        bitmapSize = bitmapSize
                    )
                ),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = GlanceModifier.fillMaxSize()
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = context.getString(R.string.today_widget_count, pace.last7DaysReviewCount),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = numberFontSize, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
            Text(
                text = context.getString(R.string.widget_last_7_days_label),
                style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = widgetPaceRingLabelFontSize),
                maxLines = 1
            )
        }
    }
}

private fun makeWidgetPaceRingBitmap(context: Context, ringProgress: Float, accentArgb: Int, bitmapSize: DpSize): Bitmap {
    return drawWidgetBitmap(size = bitmapSize, density = context.resources.displayMetrics.density) { canvas ->
        drawWidgetPaceRing(
            canvas = canvas,
            ringProgress = ringProgress,
            strokeWidthPx = canvas.width * widgetPaceRingStrokeFraction,
            trackColor = FlashcardsDarkColorScheme.surfaceVariant.toArgb(),
            progressColor = accentArgb
        )
    }
}

/**
 * The pace ring: the last 7 days against the usual 7, filled clockwise from the top over a full
 * [trackColor] circle. Past one lap a second lap in a lighter shade starts over the first and stops
 * after two; [ringProgress] is the pace ratio, already stopped at two laps.
 */
fun drawWidgetPaceRing(
    canvas: Canvas,
    ringProgress: Float,
    strokeWidthPx: Float,
    trackColor: Int,
    progressColor: Int
) {
    require(ringProgress in 0f..reviewPaceMaximumRingLaps.toFloat()) {
        "Widget pace ring progress must be in 0..$reviewPaceMaximumRingLaps, got $ringProgress."
    }
    val inset: Float = strokeWidthPx / 2f
    val bounds = RectF(inset, inset, canvas.width - inset, canvas.height - inset)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = strokeWidthPx
        strokeCap = Paint.Cap.ROUND
    }
    paint.color = trackColor
    canvas.drawOval(bounds, paint)
    val firstLap: Float = ringProgress.coerceAtMost(maximumValue = 1f)
    if (firstLap > 0f) {
        paint.color = progressColor
        canvas.drawArc(bounds, -90f, 360f * firstLap, false, paint)
    }
    val secondLap: Float = ringProgress - 1f
    if (secondLap > 0f) {
        paint.color = ColorUtils.blendARGB(progressColor, Color.White.toArgb(), widgetPaceRingSecondLapTint)
        canvas.drawArc(bounds, -90f, 360f * secondLap, false, paint)
    }
}
