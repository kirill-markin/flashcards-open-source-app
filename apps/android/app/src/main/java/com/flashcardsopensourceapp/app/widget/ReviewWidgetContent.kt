package com.flashcardsopensourceapp.app.widget

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHead
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
private val mathDelimiterRegex = Regex(pattern = """\$\$|\\\[|\\]|\\\(|\\\)|\$""")
private val emphasisRegex = Regex(pattern = """\*\*|__|~~|`|(?<!\w)[*_]|[*_](?!\w)""")
private val whitespaceRegex = Regex(pattern = """\s+""")

/**
 * A single-line preview of a card's Markdown front: markers and math delimiters dropped, image alt
 * text and link text kept, whitespace collapsed, capped at [maxLength] characters with an ellipsis.
 */
internal fun makeReviewWidgetPlainText(markdown: String, maxLength: Int): String {
    val plainText = markdown
        .replace(fencedCodeMarkerRegex, " ")
        .replace(imageRegex, " $1 ")
        .replace(linkRegex, "$1")
        .replace(lineMarkerRegex, "")
        .replace(mathDelimiterRegex, "")
        .replace(emphasisRegex, "")
        .replace(whitespaceRegex, " ")
        .trim()
    if (plainText.length <= maxLength) {
        return plainText
    }
    return plainText.take(maxLength - 1).trimEnd() + "…"
}
