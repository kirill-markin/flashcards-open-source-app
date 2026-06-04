package com.flashcardsopensourceapp.app.livesmoke.support

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.RepositorySeedCard
import com.flashcardsopensourceapp.app.RepositorySeedScenario
import com.flashcardsopensourceapp.app.createRepositorySeedExecutor
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickContentDescription
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickNode
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.currentBlockingSystemDialogSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.nodeSummary
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.scrollToText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTextToExist
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilAtLeastOneExistsOrFail
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.app.livesmoke.flows.openCardsTab
import com.flashcardsopensourceapp.app.livesmoke.flows.openReviewTab
import com.flashcardsopensourceapp.app.livesmoke.flows.updateCardText
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.feature.cards.cardsCardFrontTextTag
import com.flashcardsopensourceapp.feature.review.reviewCurrentCardFrontContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTitleTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

internal fun LiveSmokeContext.createManualCard(
    frontText: String,
    backText: String,
    markerTag: String
) {
    openCardsTab()
    clickContentDescription(contentDescription = "Add card")
    updateCardText(fieldTitle = "Front", value = frontText)
    updateCardText(fieldTitle = "Back", value = backText)
    clickText(text = "Tags", substring = false)
    composeRule.onNodeWithText("Add a tag").performTextInput(markerTag)
    clickText(text = "Add tag", substring = false)
    tapBackIcon()
    scrollToText(text = "Save")
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasClickAction().and(other = hasText("Save")),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickNode(
        matcher = hasClickAction().and(other = hasText("Save")),
        label = "Save card"
    )
    waitForTextToExist(
        text = "Search cards",
        substring = false,
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for cards search after saving a manual card"
    )
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for the saved manual card to appear"
    ) {
        visibleCardsFrontTexts().any { text -> text == frontText }
    }
}

internal fun LiveSmokeContext.rateVisibleReviewCardGood() {
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Show answer"),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickTag(tag = reviewShowAnswerButtonTag, label = "Show answer")
    clickTag(tag = reviewRateGoodButtonTag, label = "Rate Good")
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for the review queue to advance"
    ) {
        composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty() ||
            composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
    }
}

internal fun LiveSmokeContext.seedCardViaRepository(
    frontText: String,
    backText: String,
    markerTag: String
) {
    runBlocking {
        createRepositorySeedExecutor().seedCardsAndReviewsInCurrentWorkspace(
            seedScenario = RepositorySeedScenario(
                cards = listOf(
                    RepositorySeedCard(
                        frontText = frontText,
                        backText = backText,
                        tags = listOf(markerTag),
                        effortLevel = EffortLevel.MEDIUM,
                        reviews = emptyList()
                    )
                )
            )
        )
    }
    composeRule.waitForIdle()
}

internal fun LiveSmokeContext.assertCardVisibleInCards(searchText: String, timeoutMillis: Long) {
    openCardsTab()
    composeRule.onNodeWithText("Search cards").performTextReplacement(searchText)
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for cards to show '$searchText'"
        ) {
            visibleCardsFrontTexts().any { text -> text == searchText }
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Cards did not show '$searchText'. " +
                "VisibleCardFronts=${visibleCardsFrontTexts()} " +
                "LocalCard=${localCardSnapshotOrNull(expectedFrontText = searchText)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.assertCardReachableInReview(
    expectedFrontText: String,
    timeoutMillis: Long
) {
    openReviewTab()
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for review to show '$expectedFrontText'"
        ) {
            currentReviewCardFrontTextOrNull()?.contains(other = expectedFrontText) == true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Review did not show '$expectedFrontText'. " +
                "CurrentReviewFront=${currentReviewCardFrontTextOrNull()} " +
                "ReviewEmptyStateTitle=${reviewEmptyStateTitleOrNull()} " +
                "LocalCard=${localCardSnapshotOrNull(expectedFrontText = expectedFrontText)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.visibleCardsFrontTexts(): List<String> {
    return composeRule.onAllNodesWithTag(cardsCardFrontTextTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.currentReviewCardFrontTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(reviewCurrentCardFrontContentTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.reviewEmptyStateTitleOrNull(): String? {
    return composeRule.onAllNodesWithTag(reviewEmptyStateTitleTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.localCardSnapshotOrNull(expectedFrontText: String): String? {
    return runBlocking {
        val database: AppDatabase = appGraph().database
        val matchingCard = database.cardDao()
            .observeCardsWithRelations()
            .first()
            .lastOrNull { cardWithRelations ->
                cardWithRelations.card.frontText == expectedFrontText
            } ?: return@runBlocking null
        "cardId=${matchingCard.card.cardId} " +
            "workspaceId=${matchingCard.card.workspaceId} " +
            "dueAtMillis=${matchingCard.card.dueAtMillis} " +
            "fsrsCardState=${matchingCard.card.fsrsCardState} " +
            "reps=${matchingCard.card.reps} " +
            "lapses=${matchingCard.card.lapses} " +
            "tags=${matchingCard.tags.map { tag -> tag.name }}"
    }
}
