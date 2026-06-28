package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Audiotrack
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.review.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/reviewContentPresentation.ts
 - apps/ios/Flashcards/Flashcards/Review/View/ReviewContentPresentation.swift
 */

private const val reviewShortPlainWordLimit: Int = 4
private const val reviewShortPlainVisibleCharacterLimit: Int = 48

private val reviewHeadingRegex = Regex(pattern = """^\s{0,3}(#{1,6})\s+(.+?)\s*$""")
private val reviewQuoteRegex = Regex(pattern = """^\s{0,3}>\s?(.*)$""")
private val reviewBulletRegex = Regex(pattern = """^\s{0,3}[-*+]\s+(.+?)\s*$""")
private val reviewOrderedListRegex = Regex(pattern = """^\s{0,3}\d+\.\s+(.+?)\s*$""")
private val reviewFenceRegex = Regex(pattern = """^\s{0,3}(```|~~~)\s*([\w+-]+)?\s*$""")
private val reviewHorizontalRuleRegex = Regex(pattern = """^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$""")
private val reviewTableDelimiterRegex = Regex(
    pattern = """^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"""
)
private val reviewManagedMediaReferenceRegex = Regex(
    pattern = """(!)?\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)"""
)
private const val reviewManagedMediaSchemePrefix: String = "fcasset:"
private val reviewManagedMediaIconSize = 22.dp

enum class ReviewContentPresentationMode {
    SHORT_PLAIN,
    PARAGRAPH_PLAIN,
    RICH
}

sealed interface ReviewRenderedContent {
    data class ShortPlain(
        val text: String
    ) : ReviewRenderedContent

    data class ParagraphPlain(
        val text: String
    ) : ReviewRenderedContent

    data class Rich(
        val blocks: List<ReviewRichBlock>
    ) : ReviewRenderedContent
}

sealed interface ReviewRichBlock {
    data class Paragraph(
        val segments: List<ReviewInlineSegment>
    ) : ReviewRichBlock

    data class Heading(
        val level: Int,
        val segments: List<ReviewInlineSegment>
    ) : ReviewRichBlock

    data class BulletList(
        val ordered: Boolean,
        val items: List<List<ReviewInlineSegment>>
    ) : ReviewRichBlock

    data class Quote(
        val segments: List<ReviewInlineSegment>
    ) : ReviewRichBlock

    data class CodeBlock(
        val languageLabel: String?,
        val code: String
    ) : ReviewRichBlock

    data class ManagedMedia(
        val reference: ReviewManagedMediaReference
    ) : ReviewRichBlock
}

data class ReviewInlineSegment(
    val text: String,
    val isCode: Boolean
)

data class ReviewManagedMediaReference(
    val mediaAssetId: String,
    val label: String?,
    val isImageSyntax: Boolean,
    val mediaAsset: MediaAsset?
)

private enum class ReviewManagedMediaCategory {
    IMAGE,
    AUDIO,
    VIDEO,
    ATTACHMENT
}

data class PreparedReviewAnswerOption(
    val rating: ReviewRating,
    val intervalDescription: String
)

data class PreparedReviewCardPresentation(
    val card: ReviewCard,
    val tagsLabel: String,
    val dueLabel: String,
    val repsLabel: String,
    val lapsesLabel: String,
    val frontContent: ReviewRenderedContent,
    val backContent: ReviewRenderedContent,
    val frontSpeakableText: String,
    val backSpeakableText: String,
    val answerOptions: List<PreparedReviewAnswerOption>
)

data class PreparedReviewPreviewCardPresentation(
    val card: ReviewCard,
    val tagsLabel: String,
    val dueLabel: String,
    val backText: String
)

sealed interface ReviewPreviewListItem {
    val itemId: String

    data class SectionHeader(
        override val itemId: String,
        val title: String
    ) : ReviewPreviewListItem

    data class CardEntry(
        val presentation: PreparedReviewPreviewCardPresentation,
        val isCurrent: Boolean
    ) : ReviewPreviewListItem {
        override val itemId: String = presentation.card.cardId
    }
}

fun classifyReviewContentPresentation(text: String): ReviewContentPresentationMode {
    val trimmedText = text.trim()

    if (trimmedText.contains('`')) {
        return ReviewContentPresentationMode.RICH
    }
    if (hasStrongRichCue(text = trimmedText)) {
        return ReviewContentPresentationMode.RICH
    }
    if (trimmedText.isEmpty()) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }
    if (trimmedText.contains('\n') || trimmedText.contains('\r')) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }

    val wordCount = trimmedText.split(Regex("""\s+""")).count()
    if (wordCount < 1 || wordCount > reviewShortPlainWordLimit) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }
    if (trimmedText.length > reviewShortPlainVisibleCharacterLimit) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }

    return ReviewContentPresentationMode.SHORT_PLAIN
}

fun makeReviewRenderedContent(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent {
    return when (classifyReviewContentPresentation(text = text)) {
        ReviewContentPresentationMode.SHORT_PLAIN -> ReviewRenderedContent.ShortPlain(text = text)
        ReviewContentPresentationMode.PARAGRAPH_PLAIN -> ReviewRenderedContent.ParagraphPlain(text = text)
        ReviewContentPresentationMode.RICH -> ReviewRenderedContent.Rich(
            blocks = parseReviewRichBlocks(
                text = text,
                mediaAssetsById = mediaAssetsById
            )
        )
    }
}

fun makeReviewSpeakableText(text: String): String {
    if (text.trim().isEmpty()) {
        return ""
    }

    if (classifyReviewContentPresentation(text = text) != ReviewContentPresentationMode.RICH) {
        return normalizeReviewSpeakableText(lines = text.split(Regex(pattern = """\R+""")))
    }

    val speakableLines = buildList {
        var activeFenceMarker: String? = null

        text.lines().forEach { line ->
            val fenceMarker = reviewFenceMarker(line = line)

            if (activeFenceMarker != null) {
                if (fenceMarker == activeFenceMarker) {
                    activeFenceMarker = null
                }
                return@forEach
            }

            if (fenceMarker != null) {
                activeFenceMarker = fenceMarker
                return@forEach
            }

            val normalizedLine = normalizeReviewSpeakableMarkdownLine(line = line)
            if (normalizedLine.isNotEmpty()) {
                add(normalizedLine)
            }
        }
    }

    return normalizeReviewSpeakableText(lines = speakableLines)
}

fun prepareReviewCardPresentation(
    card: ReviewCard,
    answerOptions: List<ReviewAnswerOption>,
    mediaAssetsById: Map<String, MediaAsset>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation {
    val normalizedBackText = if (card.backText.trim().isEmpty()) {
        textProvider.emptyBackTextPlaceholder()
    } else {
        card.backText
    }

    return PreparedReviewCardPresentation(
        card = card,
        tagsLabel = textProvider.tagsLabel(tags = card.tags),
        dueLabel = textProvider.dueLabel(dueAtMillis = card.dueAtMillis),
        repsLabel = textProvider.repsLabel(reps = card.reps),
        lapsesLabel = textProvider.lapsesLabel(lapses = card.lapses),
        frontContent = makeReviewRenderedContent(
            text = card.frontText,
            mediaAssetsById = mediaAssetsById
        ),
        backContent = makeReviewRenderedContent(
            text = normalizedBackText,
            mediaAssetsById = mediaAssetsById
        ),
        frontSpeakableText = makeReviewSpeakableText(text = card.frontText),
        backSpeakableText = makeReviewSpeakableText(text = card.backText),
        answerOptions = answerOptions.map { option ->
            PreparedReviewAnswerOption(
                rating = option.rating,
                intervalDescription = textProvider.intervalDescription(
                    intervalDescription = option.intervalDescription
                )
            )
        }
    )
}

fun refreshPreparedReviewCardPresentationMedia(
    presentation: PreparedReviewCardPresentation,
    mediaAssetsById: Map<String, MediaAsset>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation {
    val card = presentation.card
    val normalizedBackText = if (card.backText.trim().isEmpty()) {
        textProvider.emptyBackTextPlaceholder()
    } else {
        card.backText
    }

    return presentation.copy(
        frontContent = makeReviewRenderedContent(
            text = card.frontText,
            mediaAssetsById = mediaAssetsById
        ),
        backContent = makeReviewRenderedContent(
            text = normalizedBackText,
            mediaAssetsById = mediaAssetsById
        ),
        frontSpeakableText = makeReviewSpeakableText(text = card.frontText),
        backSpeakableText = makeReviewSpeakableText(text = card.backText)
    )
}

fun prepareReviewPreviewCardPresentation(
    card: ReviewCard,
    textProvider: ReviewTextProvider
): PreparedReviewPreviewCardPresentation {
    return PreparedReviewPreviewCardPresentation(
        card = card,
        tagsLabel = textProvider.tagsLabel(tags = card.tags),
        dueLabel = textProvider.dueLabel(dueAtMillis = card.dueAtMillis),
        backText = card.backText
    )
}

fun buildReviewPreviewItems(
    cards: List<ReviewCard>,
    currentCardId: String?,
    textProvider: ReviewTextProvider
): List<ReviewPreviewListItem> {
    val visibleCards = cards.filter { card ->
        card.queueStatus != ReviewCardQueueStatus.RATED
    }
    val firstFutureCardId = visibleCards.firstOrNull { card ->
        card.queueStatus == ReviewCardQueueStatus.FUTURE
    }?.cardId

    return buildList {
        visibleCards.forEach { card ->
            if (card.cardId == firstFutureCardId) {
                add(
                    ReviewPreviewListItem.SectionHeader(
                        itemId = "section-future",
                        title = textProvider.laterSectionTitle()
                    )
                )
            }

            add(
                ReviewPreviewListItem.CardEntry(
                    presentation = prepareReviewPreviewCardPresentation(
                        card = card,
                        textProvider = textProvider
                    ),
                    isCurrent = currentCardId == card.cardId
                )
            )
        }
    }
}

@Composable
fun ReviewRenderedContentView(
    content: ReviewRenderedContent,
    modifier: Modifier = Modifier
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
            val contentColor = MaterialTheme.colorScheme.onSurface

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

                        is ReviewRichBlock.ManagedMedia -> ReviewManagedMediaPlaceholder(
                            reference = block.reference
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewManagedMediaPlaceholder(reference: ReviewManagedMediaReference) {
    val mediaAsset = reference.mediaAsset
    val category = classifyReviewManagedMediaCategory(
        mimeType = mediaAsset?.mimeType,
        isImageSyntax = reference.isImageSyntax
    )
    val isUnavailable = mediaAsset == null || mediaAsset.deletedAtMillis != null
    val categoryLabel = stringResource(id = reviewManagedMediaCategoryLabelResId(category = category))
    val label = reviewManagedMediaDisplayLabel(
        reference = reference,
        mediaAsset = mediaAsset,
        categoryLabel = categoryLabel
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                shape = MaterialTheme.shapes.medium
            )
            .padding(12.dp)
    ) {
        Icon(
            imageVector = if (isUnavailable) {
                Icons.Outlined.WarningAmber
            } else {
                reviewManagedMediaCategoryIcon(category = category)
            },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(reviewManagedMediaIconSize)
        )
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.weight(weight = 1f)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = if (isUnavailable) {
                    stringResource(id = R.string.review_media_unavailable)
                } else {
                    categoryLabel
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private fun classifyReviewManagedMediaCategory(
    mimeType: String?,
    isImageSyntax: Boolean
): ReviewManagedMediaCategory {
    val normalizedMimeType = mimeType?.lowercase()
    return when {
        normalizedMimeType == null -> {
            if (isImageSyntax) {
                ReviewManagedMediaCategory.IMAGE
            } else {
                ReviewManagedMediaCategory.ATTACHMENT
            }
        }
        normalizedMimeType.startsWith(prefix = "image/") -> ReviewManagedMediaCategory.IMAGE
        normalizedMimeType.startsWith(prefix = "audio/") -> ReviewManagedMediaCategory.AUDIO
        normalizedMimeType.startsWith(prefix = "video/") -> ReviewManagedMediaCategory.VIDEO
        else -> ReviewManagedMediaCategory.ATTACHMENT
    }
}

private fun reviewManagedMediaCategoryIcon(category: ReviewManagedMediaCategory): ImageVector {
    return when (category) {
        ReviewManagedMediaCategory.IMAGE -> Icons.Outlined.Image
        ReviewManagedMediaCategory.AUDIO -> Icons.Outlined.Audiotrack
        ReviewManagedMediaCategory.VIDEO -> Icons.Outlined.Movie
        ReviewManagedMediaCategory.ATTACHMENT -> Icons.Outlined.AttachFile
    }
}

private fun reviewManagedMediaCategoryLabelResId(category: ReviewManagedMediaCategory): Int {
    return when (category) {
        ReviewManagedMediaCategory.IMAGE -> R.string.review_media_image_label
        ReviewManagedMediaCategory.AUDIO -> R.string.review_media_audio_label
        ReviewManagedMediaCategory.VIDEO -> R.string.review_media_video_label
        ReviewManagedMediaCategory.ATTACHMENT -> R.string.review_media_attachment_label
    }
}

private fun reviewManagedMediaDisplayLabel(
    reference: ReviewManagedMediaReference,
    mediaAsset: MediaAsset?,
    categoryLabel: String
): String {
    val explicitLabel = reference.label?.trim()
    if (explicitLabel != null && explicitLabel.isNotEmpty()) {
        return explicitLabel
    }

    val sourceUrl = mediaAsset?.sourceUrl
    if (sourceUrl != null) {
        val fileName = reviewManagedMediaFileName(sourceUrl = sourceUrl)
        if (fileName != null) {
            return fileName
        }
    }

    return categoryLabel
}

private fun reviewManagedMediaFileName(sourceUrl: String): String? {
    val lastPathComponent = sourceUrl
        .substringBefore(delimiter = "?")
        .substringBefore(delimiter = "#")
        .substringAfterLast(delimiter = "/")
        .trim()
    return lastPathComponent.ifEmpty { null }
}

@Composable
private fun InlineSegmentsText(
    segments: List<ReviewInlineSegment>,
    style: androidx.compose.ui.text.TextStyle,
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

private fun hasStrongRichCue(text: String): Boolean {
    if (text.isBlank()) {
        return false
    }
    if (containsReviewManagedMediaReference(text = text)) {
        return true
    }

    return text.lineSequence().any { line ->
        reviewHeadingRegex.matches(line)
            || reviewQuoteRegex.matches(line)
            || reviewBulletRegex.matches(line)
            || reviewOrderedListRegex.matches(line)
            || reviewFenceRegex.matches(line)
            || reviewHorizontalRuleRegex.matches(line)
            || reviewTableDelimiterRegex.matches(line)
    }
}

private fun containsReviewManagedMediaReference(text: String): Boolean {
    return reviewManagedMediaReferenceRegex.findAll(input = text).any { match ->
        val reference = match.groups[3]?.value ?: return@any false
        parseReviewManagedMediaAssetId(reference = reference) != null
    }
}

private fun parseReviewManagedMediaAssetId(reference: String): String? {
    val trimmedReference = reference.trim()
    if (trimmedReference.lowercase().startsWith(prefix = reviewManagedMediaSchemePrefix).not()) {
        return null
    }

    var rawAssetId = trimmedReference.drop(n = reviewManagedMediaSchemePrefix.length)
    while (rawAssetId.startsWith(prefix = "/")) {
        rawAssetId = rawAssetId.drop(n = 1)
    }

    val fragmentOrQueryStart = rawAssetId.indexOfAny(chars = charArrayOf('?', '#'))
    val mediaAssetId = if (fragmentOrQueryStart >= 0) {
        rawAssetId.substring(startIndex = 0, endIndex = fragmentOrQueryStart)
    } else {
        rawAssetId
    }.trim()

    return mediaAssetId.ifEmpty { null }
}

private fun parseReviewRichBlocks(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewRichBlock> {
    val normalizedText = text.replace("\r\n", "\n").replace('\r', '\n')
    val lines = normalizedText.lines()
    var index = 0
    val blocks = mutableListOf<ReviewRichBlock>()

    while (index < lines.size) {
        val line = lines[index]

        if (line.isBlank()) {
            index += 1
            continue
        }

        val fenceMatch = reviewFenceRegex.matchEntire(line)
        if (fenceMatch != null) {
            val fence = fenceMatch.groupValues[1]
            val languageLabel = fenceMatch.groupValues[2].ifBlank { null }
            val codeLines = mutableListOf<String>()
            index += 1

            while (index < lines.size && reviewFenceRegex.matchEntire(lines[index])?.groupValues?.get(1) != fence) {
                codeLines += lines[index]
                index += 1
            }

            if (index < lines.size) {
                index += 1
            }

            blocks += ReviewRichBlock.CodeBlock(
                languageLabel = languageLabel,
                code = codeLines.joinToString(separator = "\n")
            )
            continue
        }

        val managedMediaBlocks = splitReviewManagedMediaLine(
            line = line,
            mediaAssetsById = mediaAssetsById
        )
        if (managedMediaBlocks != null) {
            blocks += managedMediaBlocks
            index += 1
            continue
        }

        val headingMatch = reviewHeadingRegex.matchEntire(line)
        if (headingMatch != null) {
            blocks += ReviewRichBlock.Heading(
                level = headingMatch.groupValues[1].length,
                segments = parseInlineSegments(text = headingMatch.groupValues[2])
            )
            index += 1
            continue
        }

        if (reviewQuoteRegex.matches(line)) {
            val quoteLines = mutableListOf<String>()

            while (index < lines.size) {
                val quoteMatch = reviewQuoteRegex.matchEntire(lines[index]) ?: break
                quoteLines += quoteMatch.groupValues[1]
                index += 1
            }

            blocks += ReviewRichBlock.Quote(
                segments = parseInlineSegments(text = quoteLines.joinToString(separator = "\n"))
            )
            continue
        }

        val bulletMatch = reviewBulletRegex.matchEntire(line)
        val orderedMatch = reviewOrderedListRegex.matchEntire(line)
        if (bulletMatch != null || orderedMatch != null) {
            val ordered = orderedMatch != null
            val items = mutableListOf<List<ReviewInlineSegment>>()

            while (index < lines.size) {
                val itemMatch = if (ordered) {
                    reviewOrderedListRegex.matchEntire(lines[index])
                } else {
                    reviewBulletRegex.matchEntire(lines[index])
                } ?: break

                items += parseInlineSegments(text = itemMatch.groupValues[1])
                index += 1
            }

            blocks += ReviewRichBlock.BulletList(
                ordered = ordered,
                items = items
            )
            continue
        }

        val paragraphLines = mutableListOf<String>()
        while (index < lines.size && shouldContinueParagraph(line = lines[index])) {
            paragraphLines += lines[index]
            index += 1
        }

        blocks += ReviewRichBlock.Paragraph(
            segments = parseInlineSegments(text = paragraphLines.joinToString(separator = "\n"))
        )
    }

    return if (blocks.isEmpty()) {
        listOf(
            ReviewRichBlock.Paragraph(
                segments = parseInlineSegments(text = text)
            )
        )
    } else {
        blocks
    }
}

private fun shouldContinueParagraph(line: String): Boolean {
    if (line.isBlank()) {
        return false
    }

    return reviewFenceRegex.matches(line).not()
        && containsReviewManagedMediaReference(text = line).not()
        && reviewHeadingRegex.matches(line).not()
        && reviewQuoteRegex.matches(line).not()
        && reviewBulletRegex.matches(line).not()
        && reviewOrderedListRegex.matches(line).not()
}

private fun splitReviewManagedMediaLine(
    line: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewRichBlock>? {
    val matches = reviewManagedMediaReferenceRegex.findAll(input = line).toList()
    if (matches.isEmpty()) {
        return null
    }

    val blocks = mutableListOf<ReviewRichBlock>()
    var currentIndex = 0
    var didFindManagedMedia = false

    matches.forEach { match ->
        val reference = match.groups[3]?.value ?: return@forEach
        val mediaAssetId = parseReviewManagedMediaAssetId(reference = reference) ?: return@forEach
        val matchStart = match.range.first
        val matchEndExclusive = match.range.last + 1

        appendReviewManagedMediaTextBlock(
            text = line.substring(startIndex = currentIndex, endIndex = matchStart),
            blocks = blocks
        )
        blocks += ReviewRichBlock.ManagedMedia(
            reference = ReviewManagedMediaReference(
                mediaAssetId = mediaAssetId,
                label = match.groups[2]?.value?.trim()?.ifEmpty { null },
                isImageSyntax = match.groups[1] != null,
                mediaAsset = mediaAssetsById[mediaAssetId]
            )
        )
        currentIndex = matchEndExclusive
        didFindManagedMedia = true
    }

    if (didFindManagedMedia.not()) {
        return null
    }

    appendReviewManagedMediaTextBlock(
        text = line.substring(startIndex = currentIndex),
        blocks = blocks
    )
    return blocks
}

private fun appendReviewManagedMediaTextBlock(
    text: String,
    blocks: MutableList<ReviewRichBlock>
) {
    if (text.trim().isEmpty()) {
        return
    }

    blocks += ReviewRichBlock.Paragraph(
        segments = parseInlineSegments(text = text)
    )
}

private fun parseInlineSegments(text: String): List<ReviewInlineSegment> {
    if (text.contains('`').not()) {
        return listOf(
            ReviewInlineSegment(
                text = text,
                isCode = false
            )
        )
    }

    val segments = mutableListOf<ReviewInlineSegment>()
    val currentText = StringBuilder()
    var isInsideCode = false

    text.forEach { character ->
        if (character == '`') {
            if (currentText.isNotEmpty()) {
                segments += ReviewInlineSegment(
                    text = currentText.toString(),
                    isCode = isInsideCode
                )
                currentText.clear()
            }
            isInsideCode = isInsideCode.not()
        } else {
            currentText.append(character)
        }
    }

    if (currentText.isNotEmpty()) {
        segments += ReviewInlineSegment(
            text = currentText.toString(),
            isCode = isInsideCode
        )
    }

    return if (segments.isEmpty()) {
        listOf(
            ReviewInlineSegment(
                text = text,
                isCode = false
            )
        )
    } else {
        segments
    }
}

fun reviewRenderedContentDebugText(content: ReviewRenderedContent): String {
    return when (content) {
        is ReviewRenderedContent.ShortPlain -> content.text
        is ReviewRenderedContent.ParagraphPlain -> content.text
        is ReviewRenderedContent.Rich -> content.blocks.joinToString(separator = "\n") { block ->
            when (block) {
                is ReviewRichBlock.Paragraph -> inlineSegmentsDebugText(block.segments)
                is ReviewRichBlock.Heading -> inlineSegmentsDebugText(block.segments)
                is ReviewRichBlock.BulletList -> block.items.joinToString(separator = "\n") { item ->
                    inlineSegmentsDebugText(item)
                }

                is ReviewRichBlock.Quote -> inlineSegmentsDebugText(block.segments)
                is ReviewRichBlock.CodeBlock -> block.code
                is ReviewRichBlock.ManagedMedia -> block.reference.label.orEmpty()
            }
        }
    }
}

private fun inlineSegmentsDebugText(segments: List<ReviewInlineSegment>): String {
    return buildAnnotatedString {
        segments.forEach { segment ->
            append(segment.text)
        }
    }.text
}

private fun reviewFenceMarker(line: String): String? {
    val match = reviewFenceRegex.matchEntire(line.trim())
    return match?.groups?.get(index = 1)?.value
}

private fun normalizeReviewSpeakableMarkdownLine(line: String): String {
    val trimmedLine = line.trim()
    if (trimmedLine.isEmpty()) {
        return ""
    }
    if (reviewHorizontalRuleRegex.matches(trimmedLine) || reviewTableDelimiterRegex.matches(trimmedLine)) {
        return ""
    }

    reviewHeadingRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[2])
    }
    reviewQuoteRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewBulletRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewOrderedListRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }

    return normalizeReviewSpeakableInlineText(text = trimmedLine)
}

private fun normalizeReviewSpeakableText(lines: List<String>): String {
    return lines.map { line ->
        normalizeReviewSpeakableInlineText(text = line)
    }.filter { line ->
        line.isNotEmpty()
    }.joinToString(separator = "\n")
}

private fun normalizeReviewSpeakableInlineText(text: String): String {
    return reviewSpeakableTextReplacingManagedMediaReferences(text = text)
        .replace(oldValue = "`", newValue = "")
        .replace(oldValue = "|", newValue = " ")
        .replace(regex = Regex(pattern = """\s+"""), replacement = " ")
        .trim()
}

private fun reviewSpeakableTextReplacingManagedMediaReferences(text: String): String {
    var output = text
    reviewManagedMediaReferenceRegex.findAll(input = text).toList().asReversed().forEach { match ->
        val reference = match.groups[3]?.value ?: return@forEach
        if (parseReviewManagedMediaAssetId(reference = reference) == null) {
            return@forEach
        }

        val label = match.groups[2]?.value?.trim().orEmpty()
        output = output.replaceRange(
            range = match.range,
            replacement = label
        )
    }

    return output
}
