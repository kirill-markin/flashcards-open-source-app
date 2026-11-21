package com.flashcardsopensourceapp.app.widget

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.content.makeMarkdownPlainText
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressInsights
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHead
import com.flashcardsopensourceapp.data.local.model.review.ReviewQueueHeadCard
import java.text.BreakIterator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged

private const val reviewWidgetFrontTextMaxLength: Int = 280

data class ReviewWidgetCard(
    val cardId: String,
    val frontPlainText: String
)

data class ReviewWidgetContent(
    val workspaceId: String,
    /** Due and new cards: the cards to review. */
    val dueCount: Int,
    /** The new cards among [dueCount]. */
    val newCount: Int,
    val nextDueAtMillis: Long?,
    val nextCard: ReviewWidgetCard?,
    /** The saved filter's first cards, [nextCard] first, which the Question widget rotates through. */
    val nextCards: List<ReviewWidgetCard>,
    val streakDays: Int?,
    /** The server's Progress insights; null until they have loaded and from servers without them. */
    val insights: CloudProgressInsights?
) {
    /** The cards due by schedule, without the new ones. */
    val scheduledDueCount: Int = dueCount - newCount
}

/** Null while there is no current workspace, which the widget shows as its open-the-app state. */
fun observeReviewWidgetContent(appGraph: AppGraph): Flow<ReviewWidgetContent?> {
    return combine(
        appGraph.reviewRepository.observeReviewQueueHead(),
        appGraph.progressRepository.observeSummarySnapshot()
    ) { queueHead, summarySnapshot ->
        queueHead?.let { head ->
            makeReviewWidgetContent(
                queueHead = head,
                streakDays = summarySnapshot?.renderedSummary?.currentStreakDays,
                insights = summarySnapshot?.renderedSummary?.insights
            )
        }
    }.distinctUntilChanged()
}

private fun makeReviewWidgetContent(
    queueHead: ReviewQueueHead,
    streakDays: Int?,
    insights: CloudProgressInsights?
): ReviewWidgetContent {
    return ReviewWidgetContent(
        workspaceId = queueHead.workspaceId,
        dueCount = queueHead.dueCount,
        newCount = queueHead.newCount,
        nextDueAtMillis = queueHead.nextDueAtMillis,
        nextCard = queueHead.topCard?.let(::makeReviewWidgetCard),
        nextCards = queueHead.nextCards.map(::makeReviewWidgetCard),
        streakDays = streakDays,
        insights = insights
    )
}

private fun makeReviewWidgetCard(card: ReviewQueueHeadCard): ReviewWidgetCard {
    return ReviewWidgetCard(
        cardId = card.cardId,
        frontPlainText = makeReviewWidgetPlainText(
            markdown = card.frontText,
            maxLength = reviewWidgetFrontTextMaxLength
        )
    )
}

/**
 * [makeMarkdownPlainText] capped at [maxLength] characters on a grapheme boundary with an ellipsis.
 * Image-only questions stay blank here, so the widget shows its own copy for them.
 */
internal fun makeReviewWidgetPlainText(markdown: String, maxLength: Int): String {
    val plainText: String = makeMarkdownPlainText(markdown = markdown, emptyImageAltText = "")
    if (plainText.length <= maxLength) {
        return plainText
    }
    val graphemes: BreakIterator = BreakIterator.getCharacterInstance()
    graphemes.setText(plainText)
    val cutLimit: Int = maxLength - 1
    val cutOffset: Int = if (graphemes.isBoundary(cutLimit)) cutLimit else graphemes.preceding(cutLimit)
    return plainText.substring(startIndex = 0, endIndex = cutOffset).trimEnd() + "…"
}
