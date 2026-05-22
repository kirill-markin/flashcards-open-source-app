package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawEasyReviewReaction(
    variant: ReviewReactionVariant,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (variant) {
        ReviewReactionVariant.EASY_SPARKLE_BURST -> drawEasySparkleBurst(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_RAINBOW_STREAK,
        ReviewReactionVariant.EASY_CROWN_BOUNCE,
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> drawEasyCrownBounce(
            progress = progress,
            motionMode = motionMode
        )

        else -> error("Unsupported easy review reaction variant: $variant")
    }
}

private fun DrawScope.drawEasySparkleBurst(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.56f,
        exitStart = 0.84f
    )
    val centerWaveY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 8f * (1f - phase.exit)
    }
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.40f + centerWaveY)
    val burstProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0.65f
    } else {
        reviewReactionEaseOutCubic(progress = phase.enter)
    }
    val colors: List<Color> = listOf(
        reviewReactionYellowColor,
        reviewReactionPinkColor,
        reviewReactionBlueColor,
        reviewReactionGreenColor
    )
    for (index in 0 until 18) {
        val angle: Float = index.toFloat() / 18f * PI.toFloat() * 2f
        val localProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            0.72f
        } else {
            reviewReactionClampedProgress(progress = (phase.enter - (index % 6).toFloat() * 0.055f) / 0.76f)
        }
        val radius: Float = min(size.width, size.height) * (0.10f + 0.24f * burstProgress)
        val sparkleCenter: Offset = Offset(
            x = center.x + cos(angle) * radius * (0.72f + index.toFloat() % 3f * 0.10f),
            y = center.y + sin(angle) * radius * (0.72f + index.toFloat() % 4f * 0.06f)
        )
        drawSparkle(
            center = sparkleCenter,
            radius = (9f + (index % 4).toFloat() * 4f) * (0.70f + localProgress * 0.50f),
            color = colors[index % colors.size].copy(alpha = localProgress)
        )
    }
}

private fun DrawScope.drawEasyCrownBounce(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.44f,
        exitStart = 0.82f
    )
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.40f)
    val bounce: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        sin(progress * PI.toFloat())
    } else {
        sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
    }
    val centerWaveX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 6f * (1f - phase.exit)
    }
    val centerY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter.y
    } else {
        reviewReactionInterpolate(
            start = -min(size.width, size.height) * 0.16f,
            end = targetCenter.y,
            progress = reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.10f)
        ) - bounce * 28f + phase.exit * 18f
    }
    val center: Offset = Offset(
        x = targetCenter.x + centerWaveX,
        y = centerY
    )
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionPopScale(
            progress = progress,
            enterEnd = 0.44f,
            exitStart = 0.82f,
            baseScale = 0.76f,
            peakScale = 1.16f,
            settledScale = 1.00f
        )
    }
    val scale: Float = min(size.width, size.height) / 360f * scaleMultiplier
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -3f
    } else {
        -14f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 18f + bounce * 4f
    }
    drawCrown(center = center, scale = scale, rotationDegrees = rotationDegrees)
    drawSparkle(
        center = Offset(x = center.x + 76f * scale + phase.hold * 16f, y = center.y - 48f * scale - abs(bounce) * 10f),
        radius = 14f * scale * (0.80f + sin(progress * PI.toFloat() * 5f) * 0.18f + phase.enter * 0.20f),
        color = reviewReactionYellowColor
    )
}
