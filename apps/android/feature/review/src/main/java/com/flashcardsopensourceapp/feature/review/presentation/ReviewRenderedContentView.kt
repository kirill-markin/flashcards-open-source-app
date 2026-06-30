package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl

@Composable
fun ReviewRenderedContentView(
    content: ReviewRenderedContent,
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

        is ReviewRenderedContent.Rich -> {
            val contentColor: Color = MaterialTheme.colorScheme.onSurface

            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = modifier.fillMaxWidth()
            ) {
                content.blocks.forEach { block ->
                    when (block) {
                        is ReviewRichBlock.Paragraph -> InlineSegmentsText(
                            segments = block.segments,
                            style = MaterialTheme.typography.bodyLarge,
                            color = contentColor,
                            modifier = Modifier
                        )

                        is ReviewRichBlock.Heading -> InlineSegmentsText(
                            segments = block.segments,
                            style = when (block.level) {
                                1 -> MaterialTheme.typography.headlineSmall
                                2 -> MaterialTheme.typography.titleLarge
                                else -> MaterialTheme.typography.titleMedium
                            },
                            color = contentColor,
                            modifier = Modifier
                        )

                        is ReviewRichBlock.BulletList -> Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            block.items.forEachIndexed { index, item ->
                                Row(
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        text = if (block.ordered) "${index + 1}." else "•",
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = contentColor,
                                        modifier = Modifier.padding(end = 8.dp)
                                    )
                                    InlineSegmentsText(
                                        segments = item,
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = contentColor,
                                        modifier = Modifier.weight(weight = 1f)
                                    )
                                }
                            }
                        }

                        is ReviewRichBlock.Quote -> Row(
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(end = 12.dp)
                                    .background(
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    .padding(horizontal = 2.dp, vertical = 24.dp)
                            )
                            InlineSegmentsText(
                                segments = block.segments,
                                style = MaterialTheme.typography.bodyLarge,
                                color = contentColor,
                                modifier = Modifier.weight(weight = 1f)
                            )
                        }

                        is ReviewRichBlock.CodeBlock -> Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                                    shape = MaterialTheme.shapes.medium
                                )
                                .padding(12.dp)
                        ) {
                            if (block.languageLabel != null) {
                                Text(
                                    text = block.languageLabel,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                            Text(
                                text = block.code,
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(state = rememberScrollState())
                            )
                        }

                        is ReviewRichBlock.ManagedMedia -> ReviewManagedMediaContent(
                            reference = block.reference,
                            onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InlineSegmentsText(
    segments: List<ReviewInlineSegment>,
    style: TextStyle,
    color: Color,
    modifier: Modifier
) {
    val codeStyle = SpanStyle(
        fontFamily = FontFamily.Monospace,
        background = MaterialTheme.colorScheme.surfaceContainerHighest
    )

    Text(
        text = buildAnnotatedString {
            segments.forEach { segment ->
                if (segment.isCode) {
                    pushStyle(codeStyle)
                    append(segment.text)
                    pop()
                } else {
                    append(segment.text)
                }
            }
        },
        style = style,
        color = color,
        modifier = modifier
    )
}
