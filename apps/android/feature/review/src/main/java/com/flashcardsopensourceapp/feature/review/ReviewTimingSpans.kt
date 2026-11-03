package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.core.observability.AppPerformanceSpan

private const val hasImagesAttributeKey: String = "has_images"
private const val imagesReadyAttributeKey: String = "images_ready"
private const val fullRebuildCountAttributeKey: String = "full_rebuild_count"
private const val reactionPlayedAttributeKey: String = "reaction_played"

internal data class PendingReviewNextCardVisible(
    val span: AppPerformanceSpan,
    val ratedCardId: String,
    val reactionPlayed: Boolean
)

internal data class ReviewAfterRatingWork(
    val span: AppPerformanceSpan,
    val isReviewRecorded: Boolean,
    /** Every review session emission re-runs the full session query. */
    val sessionEmissionCount: Long
)

internal fun reviewRenderedContentHasImages(content: ReviewRenderedContent): Boolean {
    if (content !is ReviewRenderedContent.ManagedMarkdown) {
        return false
    }

    return content.blocks.any { block ->
        block is ReviewManagedMarkdownBlock.ManagedMedia && block.reference.isImageSyntax
    }
}

internal fun finishReviewNextCardVisibleSpan(span: AppPerformanceSpan, hasImages: Boolean, reactionPlayed: Boolean) {
    span.setAttribute(key = hasImagesAttributeKey, value = hasImages)
    span.setAttribute(key = reactionPlayedAttributeKey, value = reactionPlayed)
    // Nothing tracks image decoding yet, so a shown image always counts as not ready.
    span.setAttribute(key = imagesReadyAttributeKey, value = hasImages.not())
    span.finish()
}

internal fun finishReviewAfterRatingWorkSpan(work: ReviewAfterRatingWork) {
    work.span.setAttribute(key = fullRebuildCountAttributeKey, value = work.sessionEmissionCount)
    work.span.finish()
}
