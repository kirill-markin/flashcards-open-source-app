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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
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
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsAppearance
import com.flashcardsopensourceapp.core.ui.theme.LocalFlashcardsAppearance
import kotlinx.coroutines.delay

internal const val firstReviewOnboardingOverlayTag = "review_first_review_onboarding_overlay"

// Dark lifts the pencil off the dark card with a hard shadow and a light outline; Light needs only a soft shadow.
// `layerAlpha` fades the shadow as one shape, so overlapping marks do not stack it darker.
private data class PencilShadowStyle(
    val left: Float,
    val top: Float,
    val pathAlpha: Float,
    val layerAlpha: Float,
    val drawsContrastOutline: Boolean
)

private val darkPencilShadowStyle = PencilShadowStyle(
    left = 1.5f,
    top = 3.5f,
    pathAlpha = .92f,
    layerAlpha = 1f,
    drawsContrastOutline = true
)
private val lightPencilShadowStyle = PencilShadowStyle(
    left = 0f,
    top = 1f,
    pathAlpha = 1f,
    layerAlpha = .18f,
    drawsContrastOutline = false
)

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
    val shadowStyle = when (LocalFlashcardsAppearance.current) {
        FlashcardsAppearance.DARK -> darkPencilShadowStyle
        FlashcardsAppearance.LIGHT -> lightPencilShadowStyle
    }
    Canvas(modifier.clearAndSetSemantics { hideFromAccessibility() }.testTag(firstReviewOnboardingOverlayTag)) {
        scale(density, density, pivot = Offset.Zero) {
            val marks = frames[if (animationsEnabled) frame else 0]
            drawContext.canvas.saveLayer(Rect(Offset.Zero, size), Paint().apply { alpha = shadowStyle.layerAlpha })
            translate(left = shadowStyle.left, top = shadowStyle.top) {
                marks.forEach { mark ->
                    if (mark.strokeWidth == null) {
                        drawPath(mark.path, Color.Black, alpha = shadowStyle.pathAlpha)
                    }
                    drawPath(
                        mark.path,
                        Color.Black,
                        alpha = shadowStyle.pathAlpha,
                        style = Stroke(
                            width = (mark.strokeWidth ?: 0f) + pencilShadowRadius * 2f,
                            cap = StrokeCap.Round,
                            join = StrokeJoin.Round
                        )
                    )
                }
            }
            drawContext.canvas.restore()
            if (shadowStyle.drawsContrastOutline) {
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
            }
            marks.forEach { mark ->
                val style = mark.strokeWidth?.let { Stroke(width = it) } ?: Fill
                drawPath(mark.path, accent, alpha = mark.opacity, style = style)
            }
        }
    }
}
