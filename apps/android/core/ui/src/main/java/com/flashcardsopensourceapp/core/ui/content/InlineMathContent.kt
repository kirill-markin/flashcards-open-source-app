package com.flashcardsopensourceapp.core.ui.content

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
import androidx.compose.ui.graphics.Color
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
import kotlin.math.ceil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * One accepted inline formula stands in the block Markdown as this single character, so the
 * Markdown parser never reinterprets LaTeX and no block syntax can appear at a paragraph start.
 */
const val inlineMathMarker: Char = '\uFFFC'

private const val reviewInlineMathLogTag: String = "ReviewInlineMath"

sealed interface InlineMathRenderState {
    data class Rendered(
        val bitmap: ImageBitmap,
        val widthPx: Float,
        val ascentPx: Float,
        val depthPx: Float
    ) : InlineMathRenderState

    data object Failed : InlineMathRenderState
}

data class InlineMathContent(
    val renderStates: Map<String, InlineMathRenderState>,
    val inlineContent: Map<String, InlineTextContent>
)

/**
 * Rendered formulas together with the exact list they were rendered from.
 *
 * Tags are positional, so a map only ever describes its own [formulas]; pairing them lets a map
 * left over from the previous card be recognized instead of drawing that card's bitmaps.
 */
private data class ReviewInlineMathRenderResult(
    val formulas: List<InlineMathFormula>,
    val renderStates: Map<String, InlineMathRenderState>,
    val colorArgb: Int,
    val fontSizePx: Float
)

fun inlineMathTag(index: Int): String {
    return "review-inline-math-$index"
}

fun countInlineMathMarkers(text: String): Int {
    return text.count { character -> character == inlineMathMarker }
}

/**
 * Drops every [inlineMathMarker] a card already carries, so the markers this pipeline injects
 * for accepted inline formulas are the only ones the marker counters can ever see.
 */
fun removeInlineMathMarkers(text: String): String {
    if (text.indexOf(char = inlineMathMarker) < 0) {
        return text
    }
    return text.filter { character -> character != inlineMathMarker }
}

@Composable
fun rememberInlineMathContent(
    formulas: List<InlineMathFormula>,
    color: Color = MaterialTheme.colorScheme.onSurface,
    fontSize: TextUnit = MaterialTheme.typography.bodyLarge.fontSize
): InlineMathContent {
    val context: Context = LocalContext.current
    val density: Density = LocalDensity.current
    val formulaColor: Int = color.toArgb()
    val formulaFontSize: TextUnit = fontSize
    val formulaFontSizePx: Float = with(density) { formulaFontSize.toPx() }

    val renderResult: ReviewInlineMathRenderResult by produceState(
        initialValue = ReviewInlineMathRenderResult(
            formulas = emptyList(),
            renderStates = emptyMap(),
            colorArgb = formulaColor,
            fontSizePx = formulaFontSizePx
        ),
        key1 = formulas,
        key2 = formulaColor,
        key3 = formulaFontSizePx
    ) {
        val reusableStates = matchingInlineMathStates(value, formulas, formulaColor, formulaFontSizePx)
        value = ReviewInlineMathRenderResult(
            formulas = formulas,
            renderStates = renderReviewInlineMathFormulas(
                context = context,
                formulas = formulas,
                colorArgb = formulaColor,
                fontSizePx = formulaFontSizePx,
                reusableStates = reusableStates
            ),
            colorArgb = formulaColor,
            fontSizePx = formulaFontSizePx
        )
    }
    // Keep completed formulas stable as chat streams new ones, while rejecting stale card/style data.
    val renderStates = matchingInlineMathStates(renderResult, formulas, formulaColor, formulaFontSizePx)

    val inlineContent: Map<String, InlineTextContent> = remember(
        formulas,
        renderStates,
        density,
        formulaFontSize
    ) {
        formulas.associate { formula ->
            val renderState: InlineMathRenderState? = renderStates[formula.tag]
            formula.tag to InlineTextContent(
                placeholder = reviewInlineMathPlaceholder(
                    renderState = renderState,
                    density = density,
                    pendingSize = formulaFontSize
                )
            ) {
                if (renderState is InlineMathRenderState.Rendered) {
                    ReviewInlineMathFormulaImage(renderState = renderState)
                }
            }
        }
    }

    return InlineMathContent(
        renderStates = renderStates,
        inlineContent = inlineContent
    )
}

/**
 * The slot sits entirely above the text baseline, so the bitmap moves down by its own depth to put
 * the formula baseline on the text baseline and hang the descender into the descender band.
 */
@Composable
private fun ReviewInlineMathFormulaImage(renderState: InlineMathRenderState.Rendered) {
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
    renderState: InlineMathRenderState?,
    density: Density,
    pendingSize: TextUnit
): Placeholder {
    if (renderState !is InlineMathRenderState.Rendered) {
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
    formulas: List<InlineMathFormula>,
    colorArgb: Int,
    fontSizePx: Float,
    reusableStates: Map<String, InlineMathRenderState>
): Map<String, InlineMathRenderState> {
    if (formulas.isEmpty()) {
        return emptyMap()
    }
    return withContext(Dispatchers.IO) {
        RaTeXFontLoader.ensureLoaded(context)
        formulas.associate { formula ->
            formula.tag to (reusableStates[formula.tag] ?: renderReviewInlineMathFormula(
                formula = formula,
                colorArgb = colorArgb,
                fontSizePx = fontSizePx
            ))
        }
    }
}

private fun matchingInlineMathStates(
    result: ReviewInlineMathRenderResult,
    formulas: List<InlineMathFormula>,
    colorArgb: Int,
    fontSizePx: Float
): Map<String, InlineMathRenderState> {
    if (result.colorArgb != colorArgb || result.fontSizePx != fontSizePx) return emptyMap()
    val previousFormulas = result.formulas.associateBy { it.tag }
    return formulas.mapNotNull { formula ->
        result.renderStates[formula.tag]?.takeIf {
            previousFormulas[formula.tag] == formula
        }?.let { formula.tag to it }
    }.toMap()
}

private fun renderReviewInlineMathFormula(
    formula: InlineMathFormula,
    colorArgb: Int,
    fontSizePx: Float
): InlineMathRenderState {
    return try {
        val displayList: DisplayList = RaTeXEngine.parseBlocking(
            latex = formula.source,
            displayMode = formula.displayMode,
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
        InlineMathRenderState.Rendered(
            bitmap = bitmap.asImageBitmap(),
            widthPx = bitmapWidth.toFloat(),
            ascentPx = renderer.heightPx,
            depthPx = renderer.depthPx
        )
    } catch (error: RaTeXException) {
        Log.e(reviewInlineMathLogTag, "RaTeX inline formula rendering failed.", error)
        InlineMathRenderState.Failed
    } catch (error: Throwable) {
        // The library's own display path reports any other throwable as a render error too, and a
        // rejected formula has to stay visible with a localized error instead of taking the screen.
        Log.e(reviewInlineMathLogTag, "Inline formula rendering failed unexpectedly.", error)
        InlineMathRenderState.Failed
    }
}

/**
 * An accepted `$…$` span that renders on the surrounding text baseline.
 *
 * The span stands in its block Markdown as one marker character, and formulas are ordered by the
 * marker they replace. [tag] is the Compose inline-content tag the rendered formula is resolved by.
 */
data class InlineMathFormula(
    val tag: String,
    val source: String,
    val delimitedSource: String,
    val displayMode: Boolean = false
)
