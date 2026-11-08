package com.flashcardsopensourceapp.app.widget

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.content.makeMarkdownPlainText
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
