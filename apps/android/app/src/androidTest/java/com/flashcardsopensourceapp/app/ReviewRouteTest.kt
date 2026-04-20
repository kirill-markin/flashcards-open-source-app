package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.feature.review.R as ReviewStringResources
import com.flashcardsopensourceapp.feature.review.ReviewEmptyState
import com.flashcardsopensourceapp.feature.review.ReviewProgressBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewUiState
import com.flashcardsopensourceapp.feature.review.reviewProgressBadgeTag
import com.flashcardsopensourceapp.feature.review.reviewQueueButtonTag
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun reviewString(resourceId: Int): String {
        return composeRule.activity.getString(resourceId)
    }

    @Test
    fun reviewRouteShowsProgressBadgeSemanticsAndNavigatesToProgress() {
        var openProgressCalls = 0
        var openPreviewCalls = 0
        var screenVisibleCalls = 0
        val streakContentDescription = composeRule.activity.resources.getQuantityString(
            ReviewStringResources.plurals.review_progress_badge_content_description,
            120,
            120
        )
        val reviewedTodayDescription = reviewString(
            ReviewStringResources.string.review_progress_badge_not_reviewed_today
        )

        composeRule.setContent {
            FlashcardsTheme {
                ReviewRoute(
                    uiState = ReviewUiState(
                        isLoading = false,
                        selectedFilter = ReviewFilter.AllCards,
                        selectedFilterTitle = "All cards",
                        remainingCount = 4,
                        totalCount = 10,
                        reviewedInSessionCount = 0,
                        isAnswerVisible = false,
                        currentCardIdForEditing = null,
                        preparedCurrentCard = null,
                        preparedNextCard = null,
                        availableDeckFilters = emptyList(),
                        availableEffortFilters = emptyList(),
                        availableTagFilters = emptyList(),
                        isPreviewLoading = false,
                        previewItems = emptyList(),
                        hasMorePreviewCards = false,
                        emptyState = ReviewEmptyState.SESSION_COMPLETE,
                        reviewProgressBadge = ReviewProgressBadgeState(
                            streakDays = 120,
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        previewErrorMessage = "",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    onSelectFilter = {},
                    onOpenPreview = {
                        openPreviewCalls += 1
                    },
                    onOpenCurrentCard = {},
                    onOpenCurrentCardWithAi = { _, _, _, _, _ -> },
                    onOpenDeckManagement = {},
                    onOpenProgress = {
                        openProgressCalls += 1
                    },
                    onCreateCard = {},
                    onCreateCardWithAi = {},
                    onSwitchToAllCards = {},
                    onScreenVisible = {
                        screenVisibleCalls += 1
                    },
                    onRevealAnswer = {},
                    onRateAgain = {},
                    onRateHard = {},
                    onRateGood = {},
                    onRateEasy = {},
                    onDismissHardAnswerReminder = {},
                    onDismissErrorMessage = {},
                    onDismissNotificationPermissionPrompt = {},
                    onContinueNotificationPermissionPrompt = {}
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            screenVisibleCalls == 1
        }

        composeRule.onNodeWithTag(reviewQueueButtonTag)
            .assertIsDisplayed()
            .performClick()
        composeRule.onNodeWithText("99+").assertIsDisplayed()
        composeRule.onNodeWithTag(reviewProgressBadgeTag)
            .assertIsDisplayed()
            .assert(
                hasSemanticsValue(
                    key = SemanticsProperties.ContentDescription,
                    expectedValue = listOf(streakContentDescription)
                )
            )
            .assert(
                hasSemanticsValue(
                    key = SemanticsProperties.StateDescription,
                    expectedValue = reviewedTodayDescription
                )
            )
            .performClick()

        assertEquals(1, screenVisibleCalls)
        assertEquals(1, openPreviewCalls)
        assertEquals(1, openProgressCalls)
    }
}

private fun <T> hasSemanticsValue(
    key: SemanticsPropertyKey<T>,
    expectedValue: T
): SemanticsMatcher {
    return SemanticsMatcher("Semantics ${key.name} equals $expectedValue") { node ->
        node.config.getOrNull(key) == expectedValue
    }
}
