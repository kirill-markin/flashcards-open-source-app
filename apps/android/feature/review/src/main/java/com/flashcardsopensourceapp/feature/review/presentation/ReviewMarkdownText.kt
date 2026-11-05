package com.flashcardsopensourceapp.feature.review

import android.net.Uri
import android.util.Log
import com.flashcardsopensourceapp.core.ui.R as CoreUiR
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.platform.LocalInspectionMode
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
import com.flashcardsopensourceapp.core.ui.content.InlineMathContent
import com.flashcardsopensourceapp.core.ui.content.InlineMathFormula
import com.flashcardsopensourceapp.core.ui.content.InlineMathRenderState
import com.flashcardsopensourceapp.core.ui.content.MathFormulaBlock
import com.flashcardsopensourceapp.core.ui.content.countInlineMathMarkers
import com.flashcardsopensourceapp.core.ui.content.inlineMathMarker
import com.flashcardsopensourceapp.core.ui.content.rememberInlineMathContent
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.components.CurrentComponentsBridge
import com.mikepenz.markdown.compose.components.MarkdownComponents
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownImage
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.ImageData
import com.mikepenz.markdown.model.ImageTransformer
import com.mikepenz.markdown.model.MarkdownAnnotator
import com.mikepenz.markdown.model.MarkdownState
import com.mikepenz.markdown.model.markdownAnnotator
import com.mikepenz.markdown.model.markdownDimens
import com.mikepenz.markdown.model.markdownInlineContent
import com.mikepenz.markdown.model.markdownPadding
import com.mikepenz.markdown.model.rememberMarkdownState
import com.mikepenz.markdown.utils.EntityConverter
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes

private const val reviewMarkdownLogTag: String = "ReviewMarkdownText"
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

/** For a whole card document; Markdown fragments get their galleries from the content parser. */
internal val reviewMarkdownGalleryComponents: MarkdownComponents = markdownComponents(
    paragraph = { model ->
        val imageNodes: List<ASTNode>? = reviewImageGalleryImageNodes(
            paragraph = model.node,
            markdown = model.content
        )
        if (imageNodes == null) {
            CurrentComponentsBridge.paragraph(model)
        } else {
            ReviewImageGallery(
                items = imageNodes,
                itemContent = { imageNode -> MarkdownImage(content = model.content, node = imageNode) },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
)

internal val reviewMarkdownPlainComponents: MarkdownComponents = markdownComponents()

@Composable
internal fun ReviewMarkdownText(
    markdown: String,
    inlineFormulas: List<InlineMathFormula>,
    components: MarkdownComponents,
    modifier: Modifier
) {
    // The parse state lives as long as its composition, so a new text starts from the loading slot.
    key(markdown) {
        ReviewMarkdownStateText(
            markdownState = rememberMarkdownState(
                content = markdown,
                lookupLinks = true,
                retainState = false,
                immediate = LocalInspectionMode.current
            ),
            inlineFormulas = inlineFormulas,
            components = components,
            makeUriHandler = ::makeReviewMarkdownUriHandler,
            modifier = modifier
        )
    }
}

/**
 * Markdown that is not a card side, such as an AI chat answer, rendered with card math and no card
 * media. A changed [markdown] keeps its previous render while it parses, so a streaming text never
 * flashes the loading slot.
 */
@Composable
fun ReviewMarkdownDocument(
    markdown: String,
    modifier: Modifier
) {
    val blocks: List<ReviewManagedMarkdownBlock> = remember(markdown) {
        makeReviewDocumentMarkdownBlocks(text = markdown)
    }
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier.fillMaxWidth()
    ) {
        blocks.forEachIndexed { index, block ->
            key(index) {
                when (block) {
                    is ReviewManagedMarkdownBlock.Markdown -> ReviewMarkdownStateText(
                        markdownState = rememberMarkdownState(
                            content = block.markdown,
                            lookupLinks = true,
                            retainState = true,
                            immediate = true
                        ),
                        inlineFormulas = block.inlineFormulas,
                        components = reviewMarkdownGalleryComponents,
                        makeUriHandler = ::makeReviewDocumentUriHandler,
                        modifier = Modifier.fillMaxWidth()
                    )

                    is ReviewManagedMarkdownBlock.Formula -> MathFormulaBlock(
                        source = block.source,
                        delimitedSource = block.delimitedSource,
                        modifier = Modifier.fillMaxWidth()
                    )

                    is ReviewManagedMarkdownBlock.ManagedMedia,
                    is ReviewManagedMarkdownBlock.ImageGallery -> throw IllegalStateException(
                        "A Markdown document splits only at display formulas, not at card media: $block"
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewMarkdownStateText(
    markdownState: MarkdownState,
    inlineFormulas: List<InlineMathFormula>,
    components: MarkdownComponents,
    makeUriHandler: (UriHandler) -> UriHandler,
    modifier: Modifier
) {
    val platformUriHandler: UriHandler = LocalUriHandler.current
    val reviewUriHandler: UriHandler = remember(platformUriHandler, makeUriHandler) {
        makeUriHandler(platformUriHandler)
    }
    val inlineMathContent: InlineMathContent = rememberInlineMathContent(
        formulas = inlineFormulas
    )
    val mathErrorMessage: String = stringResource(id = CoreUiR.string.review_math_render_failed)
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
        Markdown(
            markdownState = markdownState,
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
            components = components,
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

/**
 * Replaces every [inlineMathMarker] with its formula, so an accepted `$…$` span stays on the
 * surrounding text baseline inside its paragraph instead of becoming a block of its own, and writes
 * every dollar the contract keeps literal back from the source.
 */
private fun makeReviewInlineMathAnnotator(
    formulas: List<InlineMathFormula>,
    renderStates: Map<String, InlineMathRenderState>,
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
        if (isDollarNode.not() && nodeText.contains(char = inlineMathMarker).not()) {
            return@markdownAnnotator false
        }
        appendReviewMathNodeText(
            nodeText = nodeText,
            formulas = formulas,
            firstFormulaIndex = countInlineMathMarkers(
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
    formulas: List<InlineMathFormula>,
    firstFormulaIndex: Int,
    renderStates: Map<String, InlineMathRenderState>,
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
        if (character == inlineMathMarker) {
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
    formula: InlineMathFormula,
    renderState: InlineMathRenderState?,
    errorMessage: String,
    errorColor: Color
) {
    if (renderState is InlineMathRenderState.Failed) {
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

/** A document such as an AI answer may link anywhere, so a link Review cannot open is ignored. */
private fun makeReviewDocumentUriHandler(
    platformUriHandler: UriHandler
): UriHandler {
    return object : UriHandler {
        override fun openUri(uri: String) {
            if (isSupportedReviewMarkdownExternalUrl(url = uri)) {
                platformUriHandler.openUri(uri = uri)
            } else {
                Log.w(reviewMarkdownLogTag, "event=review_markdown_document_link_rejected url=$uri")
            }
        }
    }
}

private fun isSupportedReviewMarkdownExternalUrl(url: String): Boolean {
    val uri: Uri = Uri.parse(url)
    return uri.scheme.equals(other = "https", ignoreCase = true) &&
        uri.host.isNullOrBlank().not()
}
