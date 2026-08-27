package com.flashcardsopensourceapp.feature.review

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Log
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import io.ratex.DisplayList
import io.ratex.RaTeXEngine
import io.ratex.RaTeXException
import io.ratex.RaTeXFontLoader
import io.ratex.RaTeXRenderer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.ceil

/**
 * One accepted inline formula stands in the block Markdown as this single character, so the
 * Markdown parser never reinterprets LaTeX and no block syntax can appear at a paragraph start.
 */
internal const val reviewInlineMathMarker: Char = '\uFFFC'

private const val reviewInlineMathLogTag: String = "ReviewInlineMath"

internal sealed interface ReviewInlineMathRenderState {
    data class Rendered(
        val bitmap: ImageBitmap,
        val widthPx: Float,
        val ascentPx: Float,
        val depthPx: Float
    ) : ReviewInlineMathRenderState

    data object Failed : ReviewInlineMathRenderState
}

internal data class ReviewInlineMathContent(
    val renderStates: Map<String, ReviewInlineMathRenderState>,
    val inlineContent: Map<String, InlineTextContent>
)

/**
 * Rendered formulas together with the exact list they were rendered from.
 *
 * Tags are positional, so a map only ever describes its own [formulas]; pairing them lets a map
 * left over from the previous card be recognized instead of drawing that card's bitmaps.
 */
private data class ReviewInlineMathRenderResult(
    val formulas: List<ReviewInlineMathFormula>,
    val renderStates: Map<String, ReviewInlineMathRenderState>
)

internal fun reviewInlineMathTag(index: Int): String {
    return "review-inline-math-$index"
}

internal fun countReviewInlineMathMarkers(text: String): Int {
    return text.count { character -> character == reviewInlineMathMarker }
}

/**
 * Drops every [reviewInlineMathMarker] a card already carries, so the markers this pipeline injects
 * for accepted inline formulas are the only ones the marker counters can ever see.
 */
internal fun removeReviewInlineMathMarkers(text: String): String {
    if (text.indexOf(char = reviewInlineMathMarker) < 0) {
        return text
    }
    return text.filter { character -> character != reviewInlineMathMarker }
}

@Composable
internal fun rememberReviewInlineMathContent(
    formulas: List<ReviewInlineMathFormula>
): ReviewInlineMathContent {
    val context: Context = LocalContext.current
    val density: Density = LocalDensity.current
    val formulaColor: Int = MaterialTheme.colorScheme.onSurface.toArgb()
    val formulaFontSize: TextUnit = MaterialTheme.typography.bodyLarge.fontSize
    val formulaFontSizePx: Float = with(density) { formulaFontSize.toPx() }

    val renderResult: ReviewInlineMathRenderResult by produceState(
        initialValue = ReviewInlineMathRenderResult(
            formulas = emptyList(),
            renderStates = emptyMap()
        ),
        key1 = formulas,
        key2 = formulaColor,
        key3 = formulaFontSizePx
    ) {
        value = ReviewInlineMathRenderResult(
            formulas = formulas,
            renderStates = renderReviewInlineMathFormulas(
                context = context,
                formulas = formulas,
                colorArgb = formulaColor,
                fontSizePx = formulaFontSizePx
            )
        )
    }
    // The producer coroutine runs after this composition, so the previous card's result can still
    // be held here; a result that does not describe these formulas reads as "not yet rendered".
    val renderStates: Map<String, ReviewInlineMathRenderState> = if (
        renderResult.formulas == formulas
    ) {
        renderResult.renderStates
    } else {
        emptyMap()
    }

    val inlineContent: Map<String, InlineTextContent> = remember(
        formulas,
        renderStates,
        density,
        formulaFontSize
    ) {
        formulas.associate { formula ->
            val renderState: ReviewInlineMathRenderState? = renderStates[formula.tag]
            formula.tag to InlineTextContent(
                placeholder = reviewInlineMathPlaceholder(
                    renderState = renderState,
                    density = density,
                    pendingSize = formulaFontSize
                )
            ) {
                if (renderState is ReviewInlineMathRenderState.Rendered) {
                    ReviewInlineMathFormulaImage(renderState = renderState)
                }
            }
        }
    }

    return ReviewInlineMathContent(
        renderStates = renderStates,
        inlineContent = inlineContent
    )
}

/**
 * The slot sits entirely above the text baseline, so the bitmap moves down by its own depth to put
 * the formula baseline on the text baseline and hang the descender into the descender band.
 */
@Composable
private fun ReviewInlineMathFormulaImage(renderState: ReviewInlineMathRenderState.Rendered) {
    Spacer(
        modifier = Modifier
            .fillMaxSize()
            .drawBehind {
                drawImage(
                    image = renderState.bitmap,
                    topLeft = Offset(x = 0f, y = renderState.depthPx)
                )
            }
    )
}

private fun reviewInlineMathPlaceholder(
    renderState: ReviewInlineMathRenderState?,
    density: Density,
    pendingSize: TextUnit
): Placeholder {
    if (renderState !is ReviewInlineMathRenderState.Rendered) {
        return Placeholder(
            width = pendingSize,
            height = pendingSize,
            placeholderVerticalAlign = PlaceholderVerticalAlign.AboveBaseline
        )
    }
    return Placeholder(
        width = with(density) { renderState.widthPx.coerceAtLeast(1f).toSp() },
        height = with(density) {
            (renderState.ascentPx + renderState.depthPx).coerceAtLeast(1f).toSp()
        },
        placeholderVerticalAlign = PlaceholderVerticalAlign.AboveBaseline
    )
}

private suspend fun renderReviewInlineMathFormulas(
    context: Context,
    formulas: List<ReviewInlineMathFormula>,
    colorArgb: Int,
    fontSizePx: Float
): Map<String, ReviewInlineMathRenderState> {
    if (formulas.isEmpty()) {
        return emptyMap()
    }
    return withContext(Dispatchers.IO) {
        RaTeXFontLoader.ensureLoaded(context)
        formulas.associate { formula ->
            formula.tag to renderReviewInlineMathFormula(
                formula = formula,
                colorArgb = colorArgb,
                fontSizePx = fontSizePx
            )
        }
    }
}

private fun renderReviewInlineMathFormula(
    formula: ReviewInlineMathFormula,
    colorArgb: Int,
    fontSizePx: Float
): ReviewInlineMathRenderState {
    return try {
        val displayList: DisplayList = RaTeXEngine.parseBlocking(
            latex = formula.source,
            displayMode = false,
            color = colorArgb
        )
        val renderer = RaTeXRenderer(
            displayList = displayList,
            fontSize = fontSizePx,
            typefaceLoader = { fontId -> RaTeXFontLoader.getTypeface(fontId) }
        )
        val bitmapWidth: Int = ceil(renderer.widthPx).toInt().coerceAtLeast(minimumValue = 1)
        val bitmapHeight: Int = ceil(renderer.totalHeightPx).toInt().coerceAtLeast(minimumValue = 1)
        val bitmap: Bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
        renderer.draw(canvas = Canvas(bitmap))
        ReviewInlineMathRenderState.Rendered(
            bitmap = bitmap.asImageBitmap(),
            widthPx = bitmapWidth.toFloat(),
            ascentPx = renderer.heightPx,
            depthPx = renderer.depthPx
        )
    } catch (error: RaTeXException) {
        Log.e(reviewInlineMathLogTag, "RaTeX inline formula rendering failed.", error)
        ReviewInlineMathRenderState.Failed
    } catch (error: Throwable) {
        // The library's own display path reports any other throwable as a render error too, and a
        // rejected formula has to stay visible with a localized error instead of taking the screen.
        Log.e(reviewInlineMathLogTag, "Inline formula rendering failed unexpectedly.", error)
        ReviewInlineMathRenderState.Failed
    }
}
