package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.content.MathFormulaBlock
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl

@Composable
internal fun ReviewRenderedContentView(
    content: ReviewRenderedContent,
    reviewImagePreparer: ReviewImagePreparer,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl,
    modifier: Modifier
) {
    when (content) {
        is ReviewRenderedContent.ShortPlain -> {
            Text(
                text = content.text,
                style = MaterialTheme.typography.headlineSmall,
                modifier = modifier.fillMaxWidth()
            )
        }

        is ReviewRenderedContent.ParagraphPlain -> {
            Text(
                text = content.text,
                style = MaterialTheme.typography.bodyLarge,
                modifier = modifier.fillMaxWidth()
            )
        }

        is ReviewRenderedContent.Markdown -> {
            ReviewMarkdownText(
                markdown = content.markdown,
                inlineFormulas = emptyList(),
                components = reviewMarkdownGalleryComponents,
                modifier = modifier.fillMaxWidth()
            )
        }

        is ReviewRenderedContent.ManagedMarkdown -> {
            val sideHasText: Boolean = reviewManagedMarkdownHasText(blocks = content.blocks)
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = modifier.fillMaxWidth()
            ) {
                content.blocks.forEachIndexed { index, block ->
                    key(index) {
                        when (block) {
                            is ReviewManagedMarkdownBlock.Markdown -> ReviewMarkdownText(
                                markdown = block.markdown,
                                inlineFormulas = block.inlineFormulas,
                                components = reviewMarkdownPlainComponents,
                                modifier = Modifier.fillMaxWidth()
                            )

                            is ReviewManagedMarkdownBlock.ManagedMedia -> DisableSelection {
                                ReviewManagedMediaContent(
                                    reference = block.reference,
                                    sideHasText = sideHasText,
                                    reviewImagePreparer = reviewImagePreparer,
                                    onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                                    presentation = ReviewManagedMediaPresentation.BLOCK
                                )
                            }

                            is ReviewManagedMarkdownBlock.ImageGallery -> DisableSelection {
                                ReviewImageGallery(
                                    items = block.items,
                                    itemContent = { item ->
                                        when (item) {
                                            is ReviewImageGalleryItem.Managed -> ReviewManagedMediaContent(
                                                reference = item.reference,
                                                sideHasText = sideHasText,
                                                reviewImagePreparer = reviewImagePreparer,
                                                onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                                                presentation = ReviewManagedMediaPresentation.GALLERY_CELL
                                            )

                                            is ReviewImageGalleryItem.Linked -> ReviewMarkdownText(
                                                markdown = item.markdown,
                                                inlineFormulas = emptyList(),
                                                components = reviewMarkdownPlainComponents,
                                                modifier = Modifier.fillMaxWidth()
                                            )
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }

                            is ReviewManagedMarkdownBlock.Formula -> MathFormulaBlock(
                                source = block.source,
                                delimitedSource = block.delimitedSource,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Markdown blocks are never blank; a linked gallery image counts like any Markdown. */
private fun reviewManagedMarkdownHasText(blocks: List<ReviewManagedMarkdownBlock>): Boolean {
    return blocks.any { block ->
        when (block) {
            is ReviewManagedMarkdownBlock.Markdown,
            is ReviewManagedMarkdownBlock.Formula -> true

            is ReviewManagedMarkdownBlock.ManagedMedia -> block.reference.label != null
            is ReviewManagedMarkdownBlock.ImageGallery -> block.items.any { item ->
                when (item) {
                    is ReviewImageGalleryItem.Managed -> item.reference.label != null
                    is ReviewImageGalleryItem.Linked -> true
                }
            }
        }
    }
}
