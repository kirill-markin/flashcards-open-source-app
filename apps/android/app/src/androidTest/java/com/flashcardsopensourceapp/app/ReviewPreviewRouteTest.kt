package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.feature.review.R as ReviewStringResources
import com.flashcardsopensourceapp.feature.review.ReviewPreviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewProgressBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewPreviewRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun reviewString(resourceId: Int): String =
        composeRule.activity.getString(resourceId)

    @Test
    fun loadingStateStartsPreviewWithoutShowingEmptyOrErrorState() {
        var startPreviewCalls = 0
        val emptyTitle = reviewString(ReviewStringResources.string.review_preview_empty_title)

        composeRule.setContent {
            FlashcardsTheme {
                ReviewPreviewRoute(
                    uiState = ReviewUiState(
                        isLoading = false,
                        selectedFilter = ReviewFilter.AllCards,
                        selectedFilterTitle = "All cards",
                        remainingCount = 0,
                        totalCount = 0,
                        reviewedInSessionCount = 0,
                        isAnswerVisible = false,
                        currentCardIdForEditing = null,
                        preparedCurrentCard = null,
                        preparedNextCard = null,
                        availableDeckFilters = emptyList(),
                        availableEffortFilters = emptyList(),
                        availableTagFilters = emptyList(),
                        reviewProgressBadge = ReviewProgressBadgeState(
                            streakDays = 0,
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        isPreviewLoading = true,
                        previewItems = emptyList(),
                        hasMorePreviewCards = false,
                        emptyState = null,
                        previewErrorMessage = "",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    onStartPreview = {
                        startPreviewCalls += 1
                    },
                    onLoadNextPreviewPageIfNeeded = {},
                    onRetryPreview = {},
                    onOpenCard = {},
                    onBack = {}
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            startPreviewCalls == 1
        }
        composeRule.onNodeWithText("All cards").assertIsDisplayed()
        assertEquals(
            0,
            composeRule.onAllNodesWithText(emptyTitle).fetchSemanticsNodes().size
        )
        assertEquals(
            0,
            composeRule.onAllNodesWithText("Queue couldn't be loaded").fetchSemanticsNodes().size
        )
        assertEquals(1, startPreviewCalls)
    }

    @Test
    fun emptyStateShowsNoMatchingCardsMessage() {
        val emptyTitle = reviewString(ReviewStringResources.string.review_preview_empty_title)
        val emptyBody = reviewString(ReviewStringResources.string.review_preview_empty_body)

        composeRule.setContent {
            FlashcardsTheme {
                ReviewPreviewRoute(
                    uiState = ReviewUiState(
                        isLoading = false,
                        selectedFilter = ReviewFilter.AllCards,
                        selectedFilterTitle = "All cards",
                        remainingCount = 0,
                        totalCount = 0,
                        reviewedInSessionCount = 0,
                        isAnswerVisible = false,
                        currentCardIdForEditing = null,
                        preparedCurrentCard = null,
                        preparedNextCard = null,
                        availableDeckFilters = emptyList(),
                        availableEffortFilters = emptyList(),
                        availableTagFilters = emptyList(),
                        reviewProgressBadge = ReviewProgressBadgeState(
                            streakDays = 0,
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        isPreviewLoading = false,
                        previewItems = emptyList(),
                        hasMorePreviewCards = false,
                        emptyState = null,
                        previewErrorMessage = "",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    onStartPreview = {},
                    onLoadNextPreviewPageIfNeeded = {},
                    onRetryPreview = {},
                    onOpenCard = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText(emptyTitle).assertIsDisplayed()
        composeRule.onNodeWithText(emptyBody).assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndInvokesCallback() {
        var retryCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                ReviewPreviewRoute(
                    uiState = ReviewUiState(
                        isLoading = false,
                        selectedFilter = ReviewFilter.AllCards,
                        selectedFilterTitle = "All cards",
                        remainingCount = 0,
                        totalCount = 0,
                        reviewedInSessionCount = 0,
                        isAnswerVisible = false,
                        currentCardIdForEditing = null,
                        preparedCurrentCard = null,
                        preparedNextCard = null,
                        availableDeckFilters = emptyList(),
                        availableEffortFilters = emptyList(),
                        availableTagFilters = emptyList(),
                        reviewProgressBadge = ReviewProgressBadgeState(
                            streakDays = 0,
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        isPreviewLoading = false,
                        previewItems = emptyList(),
                        hasMorePreviewCards = false,
                        emptyState = null,
                        previewErrorMessage = "Preview failed to load.",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    onStartPreview = {},
                    onLoadNextPreviewPageIfNeeded = {},
                    onRetryPreview = {
                        retryCalls += 1
                    },
                    onOpenCard = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText("Queue couldn't be loaded").assertIsDisplayed()
        composeRule.onNodeWithText("Preview failed to load.").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1
        }
        assertEquals(1, retryCalls)
    }
}
