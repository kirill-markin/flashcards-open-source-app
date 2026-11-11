package com.flashcardsopensourceapp.app.widget

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF

/** A ring filled clockwise from the top by [fraction] (0..1) over a full [trackColor] circle. */
fun drawWidgetProgressRing(
    canvas: Canvas,
    fraction: Float,
    strokeWidthPx: Float,
    trackColor: Int,
    progressColor: Int
) {
    require(fraction in 0f..1f) { "Widget progress ring fraction must be in 0..1, got $fraction." }
    val inset: Float = strokeWidthPx / 2f
    val bounds = RectF(inset, inset, canvas.width - inset, canvas.height - inset)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = strokeWidthPx
        strokeCap = Paint.Cap.ROUND
    }
    paint.color = trackColor
    canvas.drawOval(bounds, paint)
    if (fraction > 0f) {
        paint.color = progressColor
        canvas.drawArc(bounds, -90f, 360f * fraction, false, paint)
    }
}
