package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile

@Composable
fun ReviewRenderedContentView(
    content: ReviewRenderedContent,
    onLoadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile,
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
                modifier = modifier.fillMaxWidth()
            )
        }

        is ReviewRenderedContent.ManagedMarkdown -> {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = modifier.fillMaxWidth()
            ) {
                content.blocks.forEachIndexed { index, block ->
                    key(index) {
                        when (block) {
                            is ReviewManagedMarkdownBlock.Markdown -> ReviewMarkdownText(
                                markdown = block.markdown,
                                modifier = Modifier.fillMaxWidth()
                            )

                            is ReviewManagedMarkdownBlock.ManagedMedia -> ReviewManagedMediaContent(
                                reference = block.reference,
                                onLoadManagedMediaFile = onLoadManagedMediaFile,
                                onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl
                            )

                            is ReviewManagedMarkdownBlock.Formula -> ReviewMathFormulaBlock(
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
