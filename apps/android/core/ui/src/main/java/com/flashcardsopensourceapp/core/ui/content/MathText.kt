package com.flashcardsopensourceapp.core.ui.content

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import com.flashcardsopensourceapp.core.ui.R

/**
 * Read-only source text with Review's math boundaries and renderer. Compact labels are formatted
 * after segmentation, so a localized prefix or truncation cannot change a formula's boundaries.
 * [plainText] preserves a caller's existing summary formatting when the source contains no math.
 */
@Composable
fun MathText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    fontWeight: FontWeight? = null,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    plainText: String = text,
    formatText: (String) -> String = { it }
) {
    val blocks = remember(text) {
        if ('$' in text) extractMathBlocks(removeInlineMathMarkers(text)).blocks else emptyList()
    }
    if (blocks.none { it is MathBlock.Formula }) {
        Text(
            text = formatText(plainText),
            modifier = modifier,
            color = color,
            style = style,
            fontWeight = fontWeight,
            maxLines = maxLines,
            overflow = overflow
        )
        return
    }
    val resolvedStyle = LocalTextStyle.current.merge(style).let {
        if (fontWeight == null) it else it.copy(fontWeight = fontWeight)
    }
    val contentColor = LocalContentColor.current
    val resolvedColor = color.takeOrElse { resolvedStyle.color.takeOrElse { contentColor } }
    val parts = remember(blocks, maxLines) {
        mathTextParts(blocks, compact = maxLines != Int.MAX_VALUE)
    }
    if (parts.size == 1) {
        MathTextPart(
            part = parts.single().let { it.copy(text = formatText(it.text)) },
            modifier = modifier,
            style = resolvedStyle,
            color = resolvedColor,
            maxLines = maxLines,
            overflow = overflow
        )
    } else {
        Column(modifier) {
            parts.forEach { part ->
                MathTextPart(part, Modifier, resolvedStyle, resolvedColor, maxLines, overflow)
            }
        }
    }
}

private data class MathTextPart(
    val text: String,
    val formulas: List<InlineMathFormula>,
    val display: Boolean = false
)

private fun mathTextParts(blocks: List<MathBlock>, compact: Boolean): List<MathTextPart> {
    val parts = mutableListOf<MathTextPart>()
    val text = StringBuilder()
    val formulas = mutableListOf<InlineMathFormula>()
    fun flush() {
        if (text.isNotEmpty()) parts.add(MathTextPart(text.toString(), formulas.toList()))
        text.clear()
        formulas.clear()
    }
    blocks.forEach { block ->
        when (block) {
            is MathBlock.Markdown -> text.append(block.normalizedMarkdown)
            is MathBlock.Formula -> {
                val formula = InlineMathFormula(
                    tag = inlineMathTag(formulas.size),
                    source = block.source,
                    delimitedSource = block.delimitedSource,
                    displayMode = !block.continuesParagraph
                )
                if (!block.continuesParagraph && !compact) {
                    flush()
                    parts.add(MathTextPart(inlineMathMarker.toString(), listOf(formula), display = true))
                } else {
                    text.append(inlineMathMarker)
                    formulas.add(formula)
                }
            }
        }
    }
    flush()
    return parts
}

@Composable
private fun MathTextPart(
    part: MathTextPart,
    modifier: Modifier,
    style: TextStyle,
    color: Color,
    maxLines: Int,
    overflow: TextOverflow
) {
    val math = rememberInlineMathContent(part.formulas, color = color, fontSize = style.fontSize)
    val errorMessage = stringResource(R.string.review_math_render_failed)
    val errorColor = MaterialTheme.colorScheme.error
    val annotatedText = remember(part, math.renderStates, errorMessage, errorColor) {
        buildAnnotatedString {
            var formulaIndex = 0
            part.text.forEach { character ->
                if (character != inlineMathMarker) {
                    append(character)
                } else {
                    val formula = part.formulas[formulaIndex++]
                    when (math.renderStates[formula.tag]) {
                        is InlineMathRenderState.Rendered -> appendInlineContent(
                            id = formula.tag,
                            alternateText = formula.delimitedSource
                        )
                        InlineMathRenderState.Failed -> withStyle(SpanStyle(color = errorColor)) {
                            append(formula.delimitedSource)
                            append(" $errorMessage")
                        }
                        // Streaming tails and pending formulas keep their source visible.
                        null -> append(formula.delimitedSource)
                    }
                }
            }
        }
    }
    Text(
        text = annotatedText,
        modifier = if (part.display) modifier.horizontalScroll(rememberScrollState()) else modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = overflow,
        inlineContent = math.inlineContent
    )
}
