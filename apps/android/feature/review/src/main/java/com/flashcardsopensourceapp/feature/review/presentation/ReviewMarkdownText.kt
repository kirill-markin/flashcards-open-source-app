package com.flashcardsopensourceapp.feature.review

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.ImageData
import com.mikepenz.markdown.model.ImageTransformer
import com.mikepenz.markdown.model.markdownDimens
import com.mikepenz.markdown.model.markdownPadding

private val reviewMarkdownLoadingIndicatorSize = 24.dp
private val reviewMarkdownLoadingMinimumHeight = 48.dp

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
    modifier: Modifier
) {
    val platformUriHandler: UriHandler = LocalUriHandler.current
    val reviewUriHandler: UriHandler = remember(platformUriHandler) {
        makeReviewMarkdownUriHandler(platformUriHandler = platformUriHandler)
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
