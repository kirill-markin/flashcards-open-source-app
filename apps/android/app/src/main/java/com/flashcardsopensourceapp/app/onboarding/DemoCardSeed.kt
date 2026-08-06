package com.flashcardsopensourceapp.app.onboarding

import android.content.Context
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.feature.review.R as ReviewR

const val demoCardTag: String = "demo"

private const val demoCardParagraphSeparator: String = "\n\n"

/**
 * Builds the onboarding demo card from the current app locale. The rating
 * labels are read from the review feature so the card always names the same
 * buttons the user sees while reviewing.
 *
 * The Markdown lives here rather than in the translatable strings: the back
 * text carries exactly the bold product name and the inline-code rating
 * labels. The backticks are load-bearing, not decoration.
 * `classifyReviewContentPresentation` only switches to Markdown on a backtick
 * or a block-level cue, and inline emphasis alone never switches the mode
 * (see docs/review-markdown-rendering.md). Removing the backticks would demote
 * this multi-paragraph card to plain text and show the `**` literally, so
 * whoever removes them must also remove the bold.
 */
fun buildDemoCardDraft(context: Context): CardDraft {
    val productName: String = "**${context.getString(R.string.app_name)}**"
    val againLabel: String = "`${context.getString(ReviewR.string.review_again)}`"
    val hardLabel: String = "`${context.getString(ReviewR.string.review_hard)}`"
    val backParagraphs: List<String> = listOf(
        context.getString(R.string.demo_card_back_1, productName),
        context.getString(R.string.demo_card_back_2),
        context.getString(R.string.demo_card_back_3),
        context.getString(R.string.demo_card_back_4, againLabel, hardLabel),
        context.getString(R.string.demo_card_back_5, againLabel)
    )
    return CardDraft(
        frontText = context.getString(R.string.demo_card_front),
        backText = backParagraphs.joinToString(separator = demoCardParagraphSeparator),
        tags = listOf(demoCardTag)
    )
}

/**
 * Seeds the onboarding demo card offline through the normal card creation
 * path, so the card entity, its tags, and its outbox row are written exactly
 * like a user-authored card. Call this only right after the local workspace
 * shell was newly created; the card-count guard keeps a workspace that already
 * holds cards untouched.
 */
suspend fun seedDemoCardForNewWorkspace(
    context: Context,
    database: AppDatabase,
    cardsRepository: CardsRepository,
    workspaceId: String
) {
    if (database.cardDao().loadCards(workspaceId = workspaceId).isNotEmpty()) {
        return
    }
    cardsRepository.createCard(cardDraft = buildDemoCardDraft(context = context))
}
