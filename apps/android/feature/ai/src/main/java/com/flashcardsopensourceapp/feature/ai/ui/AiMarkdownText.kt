package com.flashcardsopensourceapp.feature.ai.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.flashcardsopensourceapp.core.ui.content.MathText
import com.flashcardsopensourceapp.feature.review.ReviewContentPresentationMode
import com.flashcardsopensourceapp.feature.review.ReviewMarkdownDocument
import com.flashcardsopensourceapp.feature.review.classifyReviewContentPresentation

/** Renders markdown only where the shared review-content classifier sees it, as the web chat does. */
@Composable
internal fun AiMarkdownText(
    text: String,
    modifier: Modifier
) {
    val rendersMarkdown: Boolean = remember(text) {
        classifyReviewContentPresentation(text = text) == ReviewContentPresentationMode.RICH
    }
    if (rendersMarkdown) {
        ReviewMarkdownDocument(markdown = text, modifier = modifier)
    } else {
        MathText(text = text, modifier = modifier)
    }
}
