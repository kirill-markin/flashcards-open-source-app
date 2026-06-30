package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating

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
