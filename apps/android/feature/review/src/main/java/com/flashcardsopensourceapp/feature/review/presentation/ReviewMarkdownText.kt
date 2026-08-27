package com.flashcardsopensourceapp.feature.review

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.ImageData
import com.mikepenz.markdown.model.ImageTransformer
import com.mikepenz.markdown.model.MarkdownAnnotator
import com.mikepenz.markdown.model.markdownAnnotator
import com.mikepenz.markdown.model.markdownDimens
import com.mikepenz.markdown.model.markdownInlineContent
import com.mikepenz.markdown.model.markdownPadding
import com.mikepenz.markdown.utils.EntityConverter
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes

private val reviewMarkdownLoadingIndicatorSize = 24.dp
private val reviewMarkdownLoadingMinimumHeight = 48.dp
private val reviewMathSoftBreakRegex: Regex = Regex(pattern = """[ \t]*(?:\r\n|\r|\n)[ \t]*""")

private object ReviewNetworkImageTransformer : ImageTransformer {
    @Composable
    override fun transform(link: String): ImageData? {
        if (isSupportedReviewMarkdownExternalUrl(url = link).not()) {
            return null
        }

        return Coil3ImageTransformerImpl.transform(link = link)
    }

    @Composable
    override fun intrinsicSize(painter: Painter): Size {
        return Coil3ImageTransformerImpl.intrinsicSize(painter = painter)
    }
}

@Composable
internal fun ReviewMarkdownText(
    markdown: String,
    inlineFormulas: List<ReviewInlineMathFormula>,
    modifier: Modifier
) {
    val platformUriHandler: UriHandler = LocalUriHandler.current
    val reviewUriHandler: UriHandler = remember(platformUriHandler) {
        makeReviewMarkdownUriHandler(platformUriHandler = platformUriHandler)
    }
    val inlineMathContent: ReviewInlineMathContent = rememberReviewInlineMathContent(
        formulas = inlineFormulas
    )
    val mathErrorMessage: String = stringResource(id = R.string.review_math_render_failed)
    val mathErrorColor: Color = MaterialTheme.colorScheme.error
    val inlineMathAnnotator: MarkdownAnnotator = remember(
        inlineFormulas,
        inlineMathContent.renderStates,
        mathErrorMessage,
        mathErrorColor
    ) {
        makeReviewInlineMathAnnotator(
            formulas = inlineFormulas,
            renderStates = inlineMathContent.renderStates,
            errorMessage = mathErrorMessage,
            errorColor = mathErrorColor
        )
    }

    CompositionLocalProvider(LocalUriHandler provides reviewUriHandler) {
        key(markdown) {
            Markdown(
                content = markdown,
                colors = markdownColor(
                    text = MaterialTheme.colorScheme.onSurface,
                    codeBackground = MaterialTheme.colorScheme.surfaceContainerHighest,
                    inlineCodeBackground = MaterialTheme.colorScheme.surfaceContainerHighest,
                    dividerColor = MaterialTheme.colorScheme.outlineVariant,
                    tableBackground = MaterialTheme.colorScheme.surfaceContainer
                ),
                typography = markdownTypography(
                    h1 = MaterialTheme.typography.headlineSmall,
                    h2 = MaterialTheme.typography.titleLarge,
                    h3 = MaterialTheme.typography.titleMedium,
                    h4 = MaterialTheme.typography.titleMedium,
                    h5 = MaterialTheme.typography.titleMedium,
                    h6 = MaterialTheme.typography.titleMedium,
                    text = MaterialTheme.typography.bodyLarge,
                    code = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace
                    ),
                    inlineCode = MaterialTheme.typography.bodyLarge.copy(
                        fontFamily = FontFamily.Monospace
                    ),
                    quote = MaterialTheme.typography.bodyLarge,
                    paragraph = MaterialTheme.typography.bodyLarge,
                    ordered = MaterialTheme.typography.bodyLarge,
                    bullet = MaterialTheme.typography.bodyLarge,
                    list = MaterialTheme.typography.bodyLarge,
                    textLink = TextLinkStyles(
                        style = MaterialTheme.typography.bodyLarge.copy(
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                            textDecoration = TextDecoration.Underline
                        ).toSpanStyle()
                    ),
                    table = MaterialTheme.typography.bodyMedium
                ),
                modifier = modifier.fillMaxWidth(),
                padding = markdownPadding(
                    block = 8.dp,
                    list = 4.dp,
                    listItemTop = 4.dp,
                    listItemBottom = 4.dp,
                    listIndent = 20.dp,
                    codeBlock = PaddingValues(12.dp),
                    blockQuote = PaddingValues(horizontal = 16.dp),
                    blockQuoteText = PaddingValues(vertical = 4.dp),
                    blockQuoteBar = PaddingValues.Absolute(
                        left = 4.dp,
                        top = 2.dp,
                        right = 4.dp,
                        bottom = 2.dp
                    )
                ),
                dimens = markdownDimens(
                    dividerThickness = 1.dp,
                    codeBackgroundCornerSize = 12.dp,
                    blockQuoteThickness = 4.dp,
                    tableMaxWidth = Dp.Unspecified,
                    tableCellWidth = 140.dp,
                    tableCellPadding = 12.dp,
                    tableCornerSize = 12.dp
                ),
                imageTransformer = ReviewNetworkImageTransformer,
                annotator = inlineMathAnnotator,
                inlineContent = markdownInlineContent(content = inlineMathContent.inlineContent),
                loading = { loadingModifier ->
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = loadingModifier
                            .fillMaxWidth()
                            .heightIn(min = reviewMarkdownLoadingMinimumHeight)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(reviewMarkdownLoadingIndicatorSize)
                        )
                    }
                }
            )
        }
    }
}

/**
 * Replaces every [reviewInlineMathMarker] with its formula, so an accepted `$…$` span stays on the
 * surrounding text baseline inside its paragraph instead of becoming a block of its own, and writes
 * every dollar the contract keeps literal back from the source.
 */
private fun makeReviewInlineMathAnnotator(
    formulas: List<ReviewInlineMathFormula>,
    renderStates: Map<String, ReviewInlineMathRenderState>,
    errorMessage: String,
    errorColor: Color
): MarkdownAnnotator {
    return markdownAnnotator { content, child ->
        val startOffset: Int = child.startOffset
        val endOffset: Int = child.endOffset
        if (startOffset < 0 || startOffset >= endOffset || endOffset > content.length) {
            return@markdownAnnotator false
        }
        val isDollarNode: Boolean = child.type == GFMTokenTypes.DOLLAR ||
            child.type == GFMElementTypes.INLINE_MATH ||
            child.type == GFMElementTypes.BLOCK_MATH
        if (isDollarNode.not() && child.children.isNotEmpty()) {
            return@markdownAnnotator false
        }
        val nodeText: String = content.substring(startIndex = startOffset, endIndex = endOffset)
        if (isDollarNode.not() && nodeText.contains(char = reviewInlineMathMarker).not()) {
            return@markdownAnnotator false
        }
        appendReviewMathNodeText(
            nodeText = nodeText,
            formulas = formulas,
            firstFormulaIndex = countReviewInlineMathMarkers(
                text = content.substring(startIndex = 0, endIndex = startOffset)
            ),
            renderStates = renderStates,
            errorMessage = errorMessage,
            errorColor = errorColor
        )
        true
    }
}

/**
 * Appends one node the renderer cannot handle itself.
 *
 * The pinned renderer emits nothing for a `$`-math node and only one `$` for a longer `$` run, so
 * every dollar the contract keeps literal has to be written back from the source here.
 */
private fun AnnotatedString.Builder.appendReviewMathNodeText(
    nodeText: String,
    formulas: List<ReviewInlineMathFormula>,
    firstFormulaIndex: Int,
    renderStates: Map<String, ReviewInlineMathRenderState>,
    errorMessage: String,
    errorColor: Color
) {
    var formulaIndex: Int = firstFormulaIndex
    // A line break inside a paragraph is a soft break, which Markdown renders as a single space.
    val softBreakText: String = reviewMathSoftBreakRegex.replace(
        input = nodeText,
        replacement = " "
    )
    // A consumed node skips the renderer's own unescaping, so the same pass runs here; the marker
    // is outside its escape character class and survives untouched.
    val literalText: String = EntityConverter.replaceEntities(
        text = softBreakText,
        processEntities = false,
        processEscapes = true
    )
    literalText.forEach { character ->
        if (character == reviewInlineMathMarker) {
            formulas.getOrNull(index = formulaIndex)?.let { formula ->
                appendReviewInlineMathFormula(
                    formula = formula,
                    renderState = renderStates[formula.tag],
                    errorMessage = errorMessage,
                    errorColor = errorColor
                )
            }
            formulaIndex += 1
        } else {
            append(character)
        }
    }
}

private fun AnnotatedString.Builder.appendReviewInlineMathFormula(
    formula: ReviewInlineMathFormula,
    renderState: ReviewInlineMathRenderState?,
    errorMessage: String,
    errorColor: Color
) {
    if (renderState is ReviewInlineMathRenderState.Failed) {
        // A rejected formula stays visible as its original delimited source next to a localized error.
        withStyle(style = SpanStyle(color = errorColor, fontFamily = FontFamily.Monospace)) {
            append(formula.delimitedSource)
        }
        withStyle(style = SpanStyle(color = errorColor)) {
            append(" $errorMessage")
        }
    } else {
        // The alternate text carries the LaTeX source, which speech and accessibility read.
        appendInlineContent(id = formula.tag, alternateText = formula.source)
    }
}

private fun makeReviewMarkdownUriHandler(
    platformUriHandler: UriHandler
): UriHandler {
    return object : UriHandler {
        override fun openUri(uri: String) {
            require(isSupportedReviewMarkdownExternalUrl(url = uri)) {
                "Review Markdown links must use an absolute HTTPS URL: $uri"
            }
            platformUriHandler.openUri(uri = uri)
        }
    }
}

private fun isSupportedReviewMarkdownExternalUrl(url: String): Boolean {
    val uri: Uri = Uri.parse(url)
    return uri.scheme.equals(other = "https", ignoreCase = true) &&
        uri.host.isNullOrBlank().not()
}
