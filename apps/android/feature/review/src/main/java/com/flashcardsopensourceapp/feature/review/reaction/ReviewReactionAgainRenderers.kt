package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawAgainReviewReaction(
    variant: ReviewReactionVariant,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (variant) {
        ReviewReactionVariant.AGAIN_REWIND_VORTEX -> drawAgainRewindVortex(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.AGAIN_WARNING_TAPE -> drawAgainWarningTape(
            progress = progress,
            motionMode = motionMode
        )

        else -> error("Unsupported again review reaction variant: $variant")
    }
}

private fun DrawScope.drawAgainRewindVortex(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.46f,
        exitStart = 0.78f
    )
    val centerWaveX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 10f * (1f - phase.exit)
    }
    val centerWaveY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        cos(progress * PI.toFloat() * 2f) * 6f * (1f - phase.exit)
    }
    val center: Offset = Offset(
        x = size.width * 0.50f + centerWaveX,
        y = size.height * 0.45f + centerWaveY
    )
    val radiusPulse: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.76f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.55f) * 0.24f +
            sin(progress * PI.toFloat() * 4f) * 0.04f
    }
    val maxRadius: Float = min(size.width, size.height) * 0.31f * radiusPulse
    val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.20f)
    }
    val rotation: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        reviewReactionEaseOutCubic(progress = progress) * PI.toFloat() * 2.35f
    }
    val colors: List<Color> = listOf(reviewReactionRedColor, reviewReactionOrangeColor, reviewReactionPinkColor)
    colors.forEachIndexed { index: Int, color: Color ->
        drawSpiralStroke(
            center = center,
            maxRadius = maxRadius - index.toFloat() * 22f,
            turns = 2.25f,
            rotationRadians = rotation + index.toFloat() * 0.64f,
            progress = drawProgress,
            color = color,
            strokeWidth = 9f
        )
    }
    drawArrowTriangle(
        center = Offset(x = center.x - maxRadius * 0.58f, y = center.y - maxRadius * 0.12f),
        size = maxRadius * 0.22f,
        rotationDegrees = -132f + progress * 120f,
        color = reviewReactionRedColor
    )
    drawArrowTriangle(
        center = Offset(x = center.x + maxRadius * 0.44f, y = center.y + maxRadius * 0.24f),
        size = maxRadius * 0.18f,
        rotationDegrees = 42f + progress * 120f,
        color = reviewReactionOrangeColor
    )
}

private fun DrawScope.drawAgainWarningTape(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.34f,
        exitStart = 0.80f
    )
    val snap: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.35f)
    }
    val drift: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(phase.hold * PI.toFloat() * 2f) * 18f * (1f - phase.exit)
    }
    val exitShift: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) 0f else phase.exit * 48f
    val lengthScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionInterpolate(start = 0.18f, end = 1f, progress = min(snap, 1f))
    }

    drawWarningTapeBand(
        center = Offset(x = size.width * 0.50f + drift + exitShift, y = size.height * 0.32f - (1f - min(snap, 1f)) * 22f),
        length = size.width * 1.30f * lengthScale,
        height = 34f,
        rotationDegrees = -13f - (1f - min(snap, 1f)) * 10f,
        alpha = 1f
    )
    drawWarningTapeBand(
        center = Offset(x = size.width * 0.50f - drift - exitShift, y = size.height * 0.58f + (1f - min(snap, 1f)) * 18f),
        length = size.width * 1.24f * lengthScale,
        height = 28f,
        rotationDegrees = 12f + (1f - min(snap, 1f)) * 8f,
        alpha = 0.82f
    )
}
