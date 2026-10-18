package com.flashcardsopensourceapp.feature.review.onboarding

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.hideFromAccessibility
import kotlinx.coroutines.delay

internal const val firstReviewOnboardingOverlayTag = "review_first_review_onboarding_overlay"

@Composable
internal fun FirstReviewOnboardingOverlay(
    target: Rect,
    viewport: Size,
    availableTop: Float,
    animationsEnabled: Boolean,
    modifier: Modifier
) {
    val density = LocalDensity.current.density
    val frames = remember(target, viewport, availableTop, density) {
        val bounds = Rect(target.left / density, target.top / density, target.right / density, target.bottom / density)
        val size = Size(viewport.width / density, viewport.height / density)
        listOf(0, 1).map { firstReviewOnboardingDrawing(bounds, size, availableTop / density, it) }
    }
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(animationsEnabled) {
        frame = 0
        if (animationsEnabled) {
            while (true) {
                delay(235L)
                frame = 1 - frame
            }
        }
    }
    val accent = MaterialTheme.colorScheme.primary
    Canvas(modifier.clearAndSetSemantics { hideFromAccessibility() }.testTag(firstReviewOnboardingOverlayTag)) {
        scale(density, density, pivot = androidx.compose.ui.geometry.Offset.Zero) {
            val marks = frames[if (animationsEnabled) frame else 0]
            translate(left = 1.5f, top = 3.5f) {
                marks.forEach { mark ->
                    if (mark.strokeWidth == null) {
                        drawPath(mark.path, Color.Black, alpha = .92f)
                    }
                    drawPath(
                        mark.path,
                        Color.Black,
                        alpha = .92f,
                        style = Stroke(
                            width = (mark.strokeWidth ?: 0f) + pencilShadowRadius * 2f,
                            cap = StrokeCap.Round,
                            join = StrokeJoin.Round
                        )
                    )
                }
            }
            marks.forEach { mark ->
                drawPath(
                    mark.path,
                    Color.White,
                    alpha = .72f,
                    style = Stroke(
                        width = (mark.strokeWidth ?: 0f) + pencilContrastRadius * 2f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round
                    )
                )
            }
            marks.forEach { mark ->
                val style = mark.strokeWidth?.let { Stroke(width = it) } ?: Fill
                drawPath(mark.path, accent, alpha = mark.opacity, style = style)
            }
        }
    }
}
