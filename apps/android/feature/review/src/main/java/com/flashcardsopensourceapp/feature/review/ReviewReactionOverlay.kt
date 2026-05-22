package com.flashcardsopensourceapp.feature.review

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.delay

private const val reviewReactionAnimationMinimumProgress: Float = 0f
private const val reviewReactionAnimationMaximumProgress: Float = 1f
private const val reviewReactionCleanupExtraMillis: Long = 80L
private const val reviewReactionReducedMotionDrawingProgress: Float = 0.55f

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    events: List<ReviewReactionEvent>,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
    ) {
        events.forEach { event: ReviewReactionEvent ->
            key(event.id) {
                ReviewReactionCanvas(
                    event = event,
                    motionMode = motionMode,
                    onEventFinished = onEventFinished
                )
            }
        }
    }
}

@Composable
private fun ReviewReactionCanvas(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = event.variant,
        motionMode = motionMode
    )

    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        LaunchedEffect(event.id) {
            delay(timeMillis = durationMillis.toLong())
            onEventFinished(event.id)
        }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    this.alpha = 1f
                }
        ) {
            drawReviewReaction(
                event = event,
                progress = reviewReactionReducedMotionDrawingProgress,
                motionMode = motionMode
            )
        }
        return
    }

    val progress: Animatable<Float, AnimationVector1D> = remember(event.id) {
        Animatable(initialValue = reviewReactionAnimationMinimumProgress)
    }

    LaunchedEffect(event.id) {
        progress.snapTo(targetValue = reviewReactionAnimationMinimumProgress)
        progress.animateTo(
            targetValue = reviewReactionAnimationMaximumProgress,
            animationSpec = tween(
                durationMillis = durationMillis,
                easing = LinearEasing
            )
        )
        delay(timeMillis = reviewReactionCleanupExtraMillis)
        onEventFinished(event.id)
    }

    val currentProgress: Float = progress.value
    val drawingProgress: Float = reviewReactionClampedProgress(progress = currentProgress)
    val alpha: Float = reviewReactionOpacity(progress = currentProgress)

    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
            }
    ) {
        drawReviewReaction(
            event = event,
            progress = drawingProgress,
            motionMode = motionMode
        )
    }
}
