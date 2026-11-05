package com.flashcardsopensourceapp.app.widget

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.content.MathBlock
import com.flashcardsopensourceapp.core.ui.content.extractMathBlocks
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHead
import java.text.BreakIterator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged

private const val reviewWidgetFrontTextMaxLength: Int = 280

data class ReviewWidgetCard(
    val cardId: String,
    val frontPlainText: String
)

/** What every widget size renders; the queue part follows the Review tab badge and its saved filter. */
data class ReviewWidgetContent(
    val workspaceId: String,
    val dueCount: Int,
    val nextDueAtMillis: Long?,
    val nextCard: ReviewWidgetCard?,
    val streakDays: Int?
)

/** Null while there is no current workspace, which the widget shows as its open-the-app state. */
fun observeReviewWidgetContent(appGraph: AppGraph): Flow<ReviewWidgetContent?> {
    return combine(
        appGraph.reviewRepository.observeReviewQueueHead(),
        appGraph.progressRepository.observeSummarySnapshot()
    ) { queueHead, summarySnapshot ->
        queueHead?.let { head ->
            makeReviewWidgetContent(
                queueHead = head,
                streakDays = summarySnapshot?.renderedSummary?.currentStreakDays
            )
        }
    }.distinctUntilChanged()
}

private fun makeReviewWidgetContent(queueHead: ReviewQueueHead, streakDays: Int?): ReviewWidgetContent {
    return ReviewWidgetContent(
        workspaceId = queueHead.workspaceId,
        dueCount = queueHead.dueCount,
        nextDueAtMillis = queueHead.nextDueAtMillis,
        nextCard = queueHead.topCard?.let { card ->
            ReviewWidgetCard(
                cardId = card.cardId,
                frontPlainText = makeReviewWidgetPlainText(
                    markdown = card.frontText,
                    maxLength = reviewWidgetFrontTextMaxLength
                )
            )
        },
        streakDays = streakDays
    )
}

private val fencedCodeMarkerRegex = Regex(pattern = """(?m)^\s*(```|~~~)[^\n]*$""")
private val imageRegex = Regex(pattern = """!\[([^\]]*)]\([^)]*\)""")
private val linkRegex = Regex(pattern = """\[([^\]]*)]\([^)]*\)""")
private val lineMarkerRegex = Regex(pattern = """(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)""")
private val emphasisRegex = Regex(pattern = """\*\*|__|~~|`|(?<!\w)[*_]|[*_](?!\w)""")
private val whitespaceRegex = Regex(pattern = """\s+""")
private val backslashEscapeRegex = Regex(pattern = """\\([!-/:-@\[-`{-~])""")
private val protectedLiteralRegex = Regex(pattern = """\uE000(\d+)\uE001""")

/**
 * A single-line preview of a card's Markdown front: markers dropped, formulas kept without their
 * delimiters as Review detects them, backslash escapes resolved, image alt text and link text kept,
 * whitespace collapsed, capped at [maxLength] characters on a grapheme boundary with an ellipsis.
 */
internal fun makeReviewWidgetPlainText(markdown: String, maxLength: Int): String {
    // Formulas and escaped characters stand in as private-use placeholders, so the Markdown
    // rewrites below never touch them; the placeholders are restored before whitespace collapses.
    val protectedLiterals: MutableList<String> = mutableListOf()
    val protectLiteral: (String) -> String = { literal ->
        protectedLiterals.add(literal)
        "\uE000${protectedLiterals.lastIndex}\uE001"
    }
    val markdownWithoutMath: String = extractMathBlocks(markdown = markdown).blocks.joinToString(separator = "") { block ->
        when (block) {
            is MathBlock.Markdown -> block.markdown
            is MathBlock.Formula -> if (block.continuesParagraph) {
                protectLiteral(block.source)
            } else {
                " ${protectLiteral(block.source)} "
            }
        }
    }
    val plainText = markdownWithoutMath
        .replace(backslashEscapeRegex) { match -> protectLiteral(match.groupValues[1]) }
        .replace(fencedCodeMarkerRegex, " ")
        .replace(imageRegex, " $1 ")
        .replace(linkRegex, "$1")
        .replace(lineMarkerRegex, "")
        .replace(emphasisRegex, "")
        .replace(protectedLiteralRegex) { match -> protectedLiterals[match.groupValues[1].toInt()] }
        .replace(whitespaceRegex, " ")
        .trim()
    if (plainText.length <= maxLength) {
        return plainText
    }
    val graphemes: BreakIterator = BreakIterator.getCharacterInstance()
    graphemes.setText(plainText)
    val cutLimit: Int = maxLength - 1
    val cutOffset: Int = if (graphemes.isBoundary(cutLimit)) cutLimit else graphemes.preceding(cutLimit)
    return plainText.substring(startIndex = 0, endIndex = cutOffset).trimEnd() + "…"
}
