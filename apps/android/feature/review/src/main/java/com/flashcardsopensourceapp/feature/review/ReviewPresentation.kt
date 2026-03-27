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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/reviewContentPresentation.ts
 - apps/ios/Flashcards/Flashcards/ReviewContentPresentation.swift
 */

const val emptyReviewBackTextPlaceholder: String = "No back text"

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
}

data class ReviewInlineSegment(
    val text: String,
    val isCode: Boolean
)

data class PreparedReviewCardPresentation(
    val card: ReviewCard,
    val effortLabel: String,
    val tagsLabel: String,
    val dueLabel: String,
    val repsLabel: String,
    val lapsesLabel: String,
    val frontContent: ReviewRenderedContent,
    val backContent: ReviewRenderedContent,
    val answerOptions: List<ReviewAnswerOption>
)

data class PreparedReviewPreviewCardPresentation(
    val card: ReviewCard,
    val effortLabel: String,
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

fun makeReviewRenderedContent(text: String): ReviewRenderedContent {
    return when (classifyReviewContentPresentation(text = text)) {
        ReviewContentPresentationMode.SHORT_PLAIN -> ReviewRenderedContent.ShortPlain(text = text)
        ReviewContentPresentationMode.PARAGRAPH_PLAIN -> ReviewRenderedContent.ParagraphPlain(text = text)
        ReviewContentPresentationMode.RICH -> ReviewRenderedContent.Rich(
            blocks = parseReviewRichBlocks(text = text)
        )
    }
}

private val reviewDueLabelFormatter: DateTimeFormatter = DateTimeFormatter
    .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    .withLocale(Locale.getDefault())

fun formatReviewEffortLabel(effortLevel: EffortLevel): String {
    return effortLevel.name.lowercase().replaceFirstChar { character ->
        character.uppercase()
    }
}

fun formatReviewTagsLabel(tags: List<String>): String {
    return if (tags.isEmpty()) {
        "No tags"
    } else {
        tags.joinToString(separator = ", ")
    }
}

fun formatReviewDueLabel(dueAtMillis: Long?): String {
    if (dueAtMillis == null) {
        return "new"
    }

    return reviewDueLabelFormatter.format(
        Instant.ofEpochMilli(dueAtMillis).atZone(ZoneId.systemDefault())
    )
}

fun prepareReviewCardPresentation(
    card: ReviewCard,
    answerOptions: List<ReviewAnswerOption>
): PreparedReviewCardPresentation {
    val normalizedBackText = if (card.backText.trim().isEmpty()) {
        emptyReviewBackTextPlaceholder
    } else {
        card.backText
    }

    return PreparedReviewCardPresentation(
        card = card,
        effortLabel = formatReviewEffortLabel(effortLevel = card.effortLevel),
        tagsLabel = formatReviewTagsLabel(tags = card.tags),
        dueLabel = formatReviewDueLabel(dueAtMillis = card.dueAtMillis),
        repsLabel = "Reps ${card.reps}",
        lapsesLabel = "Lapses ${card.lapses}",
        frontContent = makeReviewRenderedContent(text = card.frontText),
        backContent = makeReviewRenderedContent(text = normalizedBackText),
        answerOptions = answerOptions
    )
}

fun prepareReviewPreviewCardPresentation(card: ReviewCard): PreparedReviewPreviewCardPresentation {
    return PreparedReviewPreviewCardPresentation(
        card = card,
        effortLabel = formatReviewEffortLabel(effortLevel = card.effortLevel),
        tagsLabel = formatReviewTagsLabel(tags = card.tags),
        dueLabel = formatReviewDueLabel(dueAtMillis = card.dueAtMillis),
        backText = card.backText
    )
}

fun buildReviewPreviewItems(
    cards: List<ReviewCard>,
    currentCardId: String?
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
                        title = "Later"
                    )
                )
            }

            add(
                ReviewPreviewListItem.CardEntry(
                    presentation = prepareReviewPreviewCardPresentation(card = card),
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
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = modifier.fillMaxWidth()
            ) {
                content.blocks.forEach { block ->
                    when (block) {
                        is ReviewRichBlock.Paragraph -> InlineSegmentsText(
                            segments = block.segments,
                            style = MaterialTheme.typography.bodyLarge
                        )

                        is ReviewRichBlock.Heading -> InlineSegmentsText(
                            segments = block.segments,
                            style = when (block.level) {
                                1 -> MaterialTheme.typography.headlineSmall
                                2 -> MaterialTheme.typography.titleLarge
                                else -> MaterialTheme.typography.titleMedium
                            }
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
                                        modifier = Modifier.padding(end = 8.dp)
                                    )
                                    InlineSegmentsText(
                                        segments = item,
                                        style = MaterialTheme.typography.bodyLarge,
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
                                        color = MaterialTheme.colorScheme.outlineVariant
                                    )
                                    .padding(horizontal = 2.dp, vertical = 24.dp)
                            )
                            InlineSegmentsText(
                                segments = block.segments,
                                style = MaterialTheme.typography.bodyLarge,
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
                    }
                }
            }
        }
    }
}

@Composable
private fun InlineSegmentsText(
    segments: List<ReviewInlineSegment>,
    style: androidx.compose.ui.text.TextStyle,
    modifier: Modifier = Modifier
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
        modifier = modifier
    )
}

private fun hasStrongRichCue(text: String): Boolean {
    if (text.isBlank()) {
        return false
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

private fun parseReviewRichBlocks(text: String): List<ReviewRichBlock> {
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
        && reviewHeadingRegex.matches(line).not()
        && reviewQuoteRegex.matches(line).not()
        && reviewBulletRegex.matches(line).not()
        && reviewOrderedListRegex.matches(line).not()
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
