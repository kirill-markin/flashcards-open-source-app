package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawHardReviewReaction(
    variant: ReviewReactionVariant,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (variant) {
        ReviewReactionVariant.HARD_HOURGLASS_SAND -> drawHardHourglassSand(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_FALLING_WEIGHT -> drawHardFallingWeight(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_YELLOW_CRACK -> drawHardYellowCrack(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_ROLLING_BOULDER -> drawHardRollingBoulder(
            progress = progress,
            motionMode = motionMode
        )

        else -> error("Unsupported hard review reaction variant: $variant")
    }
}

private fun DrawScope.drawHardHourglassSand(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.34f,
        exitStart = 0.84f
    )
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.42f)
    val height: Float = min(size.height * 0.34f, 210f)
    val width: Float = height * 0.50f
    val wobbleDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 3.4f) * 6f * (1f - phase.exit)
    }
    val breatheScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.94f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 0.06f +
            sin(progress * PI.toFloat() * 4f) * 0.018f
    }

    val topLeft: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = -width * 0.50f, y = -height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val topRight: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = width * 0.50f, y = -height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val waist: Offset = center
    val bottomLeft: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = -width * 0.50f, y = height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val bottomRight: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = width * 0.50f, y = height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )

    drawPath(
        path = polygonPath(points = listOf(topLeft, topRight, waist)),
        color = reviewReactionYellowColor.copy(alpha = 0.24f)
    )
    drawPath(
        path = polygonPath(points = listOf(waist, bottomLeft, bottomRight)),
        color = reviewReactionOrangeColor.copy(alpha = 0.28f)
    )
    drawLine(color = reviewReactionYellowColor, start = topLeft, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = topRight, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomLeft, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomRight, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = topLeft, end = topRight, strokeWidth = 10f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomLeft, end = bottomRight, strokeWidth = 10f, cap = StrokeCap.Round)

    val sandDropHeight: Float = height * 0.22f * reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.35f)
    drawLine(
        color = reviewReactionOrangeColor,
        start = Offset(x = center.x, y = center.y - sandDropHeight * 0.48f),
        end = Offset(x = center.x, y = center.y + sandDropHeight),
        strokeWidth = 4f,
        cap = StrokeCap.Round
    )
    drawOval(
        color = reviewReactionOrangeColor,
        topLeft = Offset(x = center.x - width * 0.22f, y = center.y + height * 0.28f),
        size = Size(width = width * 0.44f, height = height * 0.12f)
    )
}

private fun DrawScope.drawHardFallingWeight(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.52f,
        exitStart = 0.82f
    )
    val fallProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionEaseInCubic(progress = phase.enter)
    }
    val rebound: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(phase.hold * PI.toFloat() * 2.2f) * (1f - phase.hold)
    }
    val center: Offset = Offset(
        x = size.width * 0.50f,
        y = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            size.height * 0.52f
        } else {
            reviewReactionInterpolate(start = size.height * -0.16f, end = size.height * 0.52f, progress = fallProgress) -
                rebound * 24f + phase.exit * 22f
        }
    )
    val stretch: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) 0f else (1f - phase.enter) * 0.16f
    drawWeight(
        center = center,
        width = min(size.width, size.height) * 0.36f,
        height = min(size.width, size.height) * 0.25f,
        xScale = 1f + stretch,
        yScale = 1f - stretch * 0.7f
    )
    drawImpactLines(
        center = Offset(x = center.x, y = size.height * 0.68f),
        radius = min(size.width, size.height) * 0.20f,
        progress = reviewReactionClampedProgress(progress = phase.enter + phase.hold),
        color = reviewReactionYellowColor
    )
}

private fun DrawScope.drawHardYellowCrack(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.64f,
        exitStart = 0.82f
    )
    val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        min(phase.enter * 1.12f, 1f)
    }
    val impactGlow: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(min(phase.enter, 1f) * PI.toFloat())
    }
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.44f)
    drawCircle(
        color = reviewReactionYellowColor.copy(alpha = 0.22f + impactGlow * 0.20f),
        radius = min(size.width, size.height) * 0.26f,
        center = center
    )
    val points: List<Offset> = listOf(
        Offset(x = size.width * 0.46f, y = size.height * 0.22f),
        Offset(x = size.width * 0.53f, y = size.height * 0.36f),
        Offset(x = size.width * 0.47f, y = size.height * 0.46f),
        Offset(x = size.width * 0.55f, y = size.height * 0.58f),
        Offset(x = size.width * 0.49f, y = size.height * 0.76f)
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = Color.Black.copy(alpha = 0.32f),
        strokeWidth = 17f
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = reviewReactionYellowColor,
        strokeWidth = 10f
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = Color.White.copy(alpha = 0.72f),
        strokeWidth = 3f
    )
    listOf(
        listOf(points[1], Offset(x = size.width * 0.34f, y = size.height * 0.33f)),
        listOf(points[2], Offset(x = size.width * 0.66f, y = size.height * 0.48f)),
        listOf(points[3], Offset(x = size.width * 0.35f, y = size.height * 0.66f))
    ).forEachIndexed { index: Int, branch: List<Offset> ->
        val branchProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            1f
        } else {
            reviewReactionClampedProgress(progress = (phase.enter - index.toFloat() * 0.18f) / 0.62f)
        }
        drawPolylineProgress(
            points = branch,
            progress = branchProgress,
            color = reviewReactionYellowColor,
            strokeWidth = 6f
        )
    }
}

private fun DrawScope.drawHardRollingBoulder(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.62f,
        exitStart = 0.82f
    )
    val baseY: Float = size.height * 0.56f
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = baseY)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter
    } else if (progress < 0.62f) {
        val travel: Float = reviewReactionEaseInOut(progress = phase.enter)
        val hop: Float = abs(sin(phase.enter * PI.toFloat() * 3f)) * 22f * (1f - phase.enter * 0.35f)
        Offset(
            x = reviewReactionInterpolate(start = size.width * -0.22f, end = targetCenter.x, progress = travel),
            y = baseY - hop
        )
    } else if (progress < 0.82f) {
        Offset(
            x = targetCenter.x + sin(phase.hold * PI.toFloat() * 2f) * 10f * (1f - phase.hold),
            y = baseY - abs(sin(phase.hold * PI.toFloat() * 2f)) * 9f * (1f - phase.hold)
        )
    } else {
        val exit: Float = reviewReactionEaseInCubic(progress = phase.exit)
        Offset(x = reviewReactionInterpolate(start = targetCenter.x, end = size.width * 1.20f, progress = exit), y = baseY)
    }
    val radiusScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.92f + sin(progress * PI.toFloat() * 3.5f) * 0.05f + phase.enter * 0.08f
    }
    val radius: Float = min(size.width, size.height) * 0.14f * radiusScale
    drawDustCloud(
        center = Offset(x = center.x - radius * 0.62f, y = baseY + radius * 0.60f),
        radius = radius,
        progress = reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.4f)
    )
    drawBoulder(center = center, radius = radius, rotationDegrees = progress * 720f)
}
