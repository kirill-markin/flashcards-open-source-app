package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.feature.review.R as ReviewStringResources
import com.flashcardsopensourceapp.feature.review.ReviewEmptyState
import com.flashcardsopensourceapp.feature.review.ReviewLeaderboardBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewProgressBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewUiState
import com.flashcardsopensourceapp.feature.review.reviewLeaderboardShortcutTag
import com.flashcardsopensourceapp.feature.review.reviewProgressBadgeTag
import com.flashcardsopensourceapp.feature.review.reviewQueueButtonTag
import com.flashcardsopensourceapp.feature.review.reaction.rememberReviewReactionLottieConfigurationStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
    fun reviewRouteShowsTopBarShortcutSemanticsAndNavigatesToProgress() {
        var openLeaderboardCalls = 0
        var openProgressCalls = 0
        var openPreviewCalls = 0
        var screenVisibleCalls = 0
        val leaderboardRank = 3
        val leaderboardShortcutContentDescription = composeRule.activity.getString(
            ReviewStringResources.string.review_leaderboard_shortcut_rank_content_description,
            leaderboardRank
        )
        val streakContentDescription = composeRule.activity.resources.getQuantityString(
            ReviewStringResources.plurals.review_progress_badge_content_description,
            120,
            120
        )
        val reviewedTodayDescription = reviewString(
            ReviewStringResources.string.review_progress_badge_not_reviewed_today
        )
        val reviewQueueContentDescription = composeRule.activity.resources.getQuantityString(
            ReviewStringResources.plurals.review_queue_button_content_description,
            10,
            10
        )

        composeRule.setContent {
            FlashcardsTheme {
                val reviewReactionLottieConfigurationStore =
                    rememberReviewReactionLottieConfigurationStore()
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
                        reviewLeaderboardBadge = ReviewLeaderboardBadgeState(
                            rank = leaderboardRank,
                            windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
                            isInteractive = true
                        ),
                        isPreviewLoading = false,
                        previewItems = emptyList(),
                        hasMorePreviewCards = false,
                        emptyState = ReviewEmptyState.SESSION_COMPLETE,
                        reviewProgressBadge = ReviewProgressBadgeState(
                            streakDays = 120,
                            freezeAvailableCredits = 0,
                            freezeCapacity = 0,
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        previewErrorMessage = "",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    reviewReactionLottieConfigurationStore = reviewReactionLottieConfigurationStore,
                    reviewReactionAnimationsEnabled = true,
                    onSelectFilter = {},
                    onOpenPreview = {
                        openPreviewCalls += 1
                    },
                    onOpenCurrentCard = {},
                    onOpenCurrentCardWithAi = { _, _, _, _, _ -> },
                    onOpenDeckManagement = {},
                    onOpenLeaderboard = {
                        openLeaderboardCalls += 1
                    },
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
            screenVisibleCalls > 0
        }

        composeRule.onNodeWithTag(reviewQueueButtonTag)
            .assertIsDisplayed()
            .assert(
                hasSemanticsValue(
                    key = SemanticsProperties.ContentDescription,
                    expectedValue = listOf(reviewQueueContentDescription)
                )
            )
            .performClick()
        composeRule.onAllNodesWithText("10").assertCountEquals(0)
        composeRule.onNodeWithText("99+").assertIsDisplayed()
        composeRule.onNodeWithText("3").assertIsDisplayed()
        composeRule.onNodeWithTag(reviewLeaderboardShortcutTag)
            .assertIsDisplayed()
            .assert(
                hasSemanticsValue(
                    key = SemanticsProperties.ContentDescription,
                    expectedValue = listOf(leaderboardShortcutContentDescription)
                )
            )
            .performClick()
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

        assertTrue(screenVisibleCalls > 0)
        assertEquals(1, openLeaderboardCalls)
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
