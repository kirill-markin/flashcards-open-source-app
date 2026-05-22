package com.flashcardsopensourceapp.feature.review

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

        ReviewReactionVariant.EASY_RAINBOW_STREAK -> drawEasyRainbowStreak(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_CROWN_BOUNCE -> drawEasyCrownBounce(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_UNICORN_FLYBY -> drawEasyUnicornFlyby(
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

private fun DrawScope.drawEasyRainbowStreak(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.40f,
        exitStart = 0.78f
    )
    val centerX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        size.width * 0.50f
    } else if (progress < 0.40f) {
        reviewReactionInterpolate(start = -size.width * 0.24f, end = size.width * 0.50f, progress = reviewReactionEaseOutCubic(progress = phase.enter))
    } else if (progress < 0.78f) {
        size.width * 0.50f + sin(phase.hold * PI.toFloat() * 2f) * 22f
    } else {
        reviewReactionInterpolate(start = size.width * 0.50f, end = size.width * 1.24f, progress = reviewReactionEaseInCubic(progress = phase.exit))
    }
    val center: Offset = Offset(x = centerX, y = size.height * 0.42f)
    val colors: List<Color> = listOf(
        reviewReactionRedColor,
        reviewReactionOrangeColor,
        reviewReactionYellowColor,
        reviewReactionGreenColor,
        reviewReactionBlueColor,
        reviewReactionPurpleColor
    )
    colors.forEachIndexed { index: Int, color: Color ->
        val offset: Float = (index - 2).toFloat() * 11f
        drawCubicStroke(
            start = Offset(x = center.x - size.width * 0.48f, y = center.y + offset + 10f),
            control1 = Offset(x = center.x - size.width * 0.22f, y = center.y + offset - 54f - sin(progress * PI.toFloat() * 2f) * 12f),
            control2 = Offset(x = center.x + size.width * 0.20f, y = center.y + offset + 46f + sin(progress * PI.toFloat() * 2f + index.toFloat()) * 12f),
            end = Offset(x = center.x + size.width * 0.48f, y = center.y + offset - 14f),
            progress = 1f,
            color = color.copy(alpha = 0.78f),
            strokeWidth = 10f
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

private fun DrawScope.drawEasyUnicornFlyby(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.42f,
        exitStart = 0.80f
    )
    val displayCenter: Offset = Offset(x = size.width * 0.56f, y = size.height * 0.30f)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        displayCenter
    } else if (progress < 0.42f) {
        cubicBezierPoint(
            start = Offset(x = size.width * 1.18f, y = size.height * 0.22f),
            control1 = Offset(x = size.width * 0.92f, y = size.height * 0.08f),
            control2 = Offset(x = size.width * 0.68f, y = size.height * 0.20f),
            end = displayCenter,
            progress = reviewReactionEaseOutCubic(progress = phase.enter)
        )
    } else if (progress < 0.80f) {
        Offset(
            x = displayCenter.x + sin(phase.hold * PI.toFloat() * 2f) * 20f,
            y = displayCenter.y + sin(phase.hold * PI.toFloat() * 4f) * 14f
        )
    } else {
        cubicBezierPoint(
            start = displayCenter,
            control1 = Offset(x = size.width * 0.36f, y = size.height * 0.16f),
            control2 = Offset(x = size.width * 0.08f, y = size.height * 0.12f),
            end = Offset(x = size.width * -0.24f, y = size.height * 0.28f),
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.84f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.18f) * 0.20f -
            phase.exit * 0.12f
    }
    val scale: Float = min(size.width, size.height) / 410f * scaleMultiplier
    drawRainbowTrail(
        center = Offset(x = center.x + 20f * scale, y = center.y + 26f * scale),
        length = min(size.width, size.height) * 0.42f,
        scale = scale,
        progress = if (motionMode == ReviewReactionMotionMode.REDUCED) 0.70f else phase.enter + phase.hold * 0.30f
    )
    drawUnicorn(center = center, scale = scale, rotationDegrees = -8f + sin(progress * PI.toFloat() * 4f) * 4f)
}
