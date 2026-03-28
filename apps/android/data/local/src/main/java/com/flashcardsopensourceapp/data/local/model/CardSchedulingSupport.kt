package com.flashcardsopensourceapp.data.local.model

fun isCardDue(card: CardSummary, nowMillis: Long): Boolean {
    val dueAtMillis = card.dueAtMillis
    return dueAtMillis == null || dueAtMillis <= nowMillis
}

fun isNewCard(card: CardSummary): Boolean {
    return card.reps == 0 && card.lapses == 0
}

fun isReviewedCard(card: CardSummary): Boolean {
    return card.reps > 0 || card.lapses > 0
}

// Keep in sync with apps/backend/src/cards.ts::toReviewableCardScheduleState and apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::makeReviewableCardScheduleState(card:).
fun toReviewableCardScheduleState(card: CardSummary): ReviewableCardScheduleState {
    return ReviewableCardScheduleState(
        cardId = card.cardId,
        reps = card.reps,
        lapses = card.lapses,
        fsrsCardState = card.fsrsCardState,
        fsrsStepIndex = card.fsrsStepIndex,
        fsrsStability = card.fsrsStability,
        fsrsDifficulty = card.fsrsDifficulty,
        fsrsLastReviewedAtMillis = card.fsrsLastReviewedAtMillis,
        fsrsScheduledDays = card.fsrsScheduledDays
    )
}
