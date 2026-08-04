package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.espresso.Espresso.pressBack
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import com.flashcardsopensourceapp.feature.review.R as ReviewStringResources
import com.flashcardsopensourceapp.feature.review.ReviewEmptyState
import com.flashcardsopensourceapp.feature.review.ReviewLeaderboardBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewProgressBadgeState
import com.flashcardsopensourceapp.feature.review.ReviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewUiState
import com.flashcardsopensourceapp.feature.review.reviewFilterAllCardsOptionTag
import com.flashcardsopensourceapp.feature.review.reviewFilterButtonTag
import com.flashcardsopensourceapp.feature.review.reviewFilterSheetTag
import com.flashcardsopensourceapp.feature.review.reviewFilterTagOptionTag
import com.flashcardsopensourceapp.feature.review.reviewLeaderboardShortcutTag
import com.flashcardsopensourceapp.feature.review.reviewManageDecksButtonTag
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
                    rememberReviewReactionLottieConfigurationStore(loadLottieCompositions = true)
                ReviewRoute(
                    uiState = ReviewUiState(
                        isLoading = false,
                        requestedFilter = ReviewFilter.AllCards,
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
                            hasReviewedToday = false,
                            isInteractive = true
                        ),
                        previewErrorMessage = "",
                        errorMessage = "",
                        isNotificationPermissionPromptVisible = false,
                        isHardAnswerReminderVisible = false
                    ),
                    workspaceId = "review-route-test-workspace",
                    reviewReactionLottieConfigurationStore = reviewReactionLottieConfigurationStore,
                    reviewReactionAnimationsEnabled = true,
                    onSelectFilter = { _, _, _ -> },
                    onOpenPreview = {
                        openPreviewCalls += 1
                    },
                    onOpenCurrentCard = {},
                    onOpenCurrentCardWithAi = { _, _, _, _ -> },
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
                    onLoadManagedMediaFile = { mediaAssetId ->
                        throw UnsupportedOperationException(
                            "ReviewRouteTest does not load managed media files. mediaAssetId=$mediaAssetId"
                        )
                    },
                    onLoadManagedMediaDownloadUrl = { mediaAssetId ->
                        throw UnsupportedOperationException(
                            "ReviewRouteTest does not load managed media. mediaAssetId=$mediaAssetId"
                        )
                    },
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

    @Test
    fun reviewFilterDraftStaysLocalAndAppliesExactlyOnceOnOutsideDismissal() {
        val filterSelections = mutableListOf<ReviewFilterSelection>()

        composeRule.setContent {
            ReviewRouteTestContent(
                uiState = reviewRouteUiState(
                    isLoading = false,
                    requestedFilter = ReviewFilter.AllCards
                ),
                workspaceId = reviewRouteWorkspaceId,
                onSelectFilter = { workspaceId, openingFilter, selectedFilter ->
                    filterSelections += ReviewFilterSelection(
                        workspaceId = workspaceId,
                        openingFilter = openingFilter,
                        selectedFilter = selectedFilter
                    )
                },
                onOpenDeckManagement = {},
                onScreenVisible = {}
            )
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithTag(reviewFilterAllCardsOptionTag).performClick()
        composeRule.onNodeWithTag(reviewFilterAllCardsOptionTag).assertIsOff()
        composeRule.runOnIdle {
            assertTrue(filterSelections.isEmpty())
        }

        val filterSheet = composeRule.onNodeWithTag(reviewFilterSheetTag)
        val filterSheetTop = filterSheet.fetchSemanticsNode().boundsInRoot.top
        filterSheet.performTouchInput {
            click(position = Offset(x = center.x, y = -filterSheetTop / 2f))
        }
        composeRule.onNodeWithTag(reviewFilterSheetTag).assertDoesNotExist()
        composeRule.runOnIdle {
            assertEquals(
                listOf(
                    ReviewFilterSelection(
                        workspaceId = reviewRouteWorkspaceId,
                        openingFilter = ReviewFilter.AllCards,
                        selectedFilter = ReviewFilter.Tags(tags = emptyList())
                    )
                ),
                filterSelections
            )
        }
    }

    @Test
    fun reviewFilterManageDecksFinalizesDraftBeforeNavigation() {
        val filterSelections = mutableListOf<ReviewFilterSelection>()
        var openDeckManagementCalls = 0

        composeRule.setContent {
            ReviewRouteTestContent(
                uiState = reviewRouteUiState(
                    isLoading = false,
                    requestedFilter = ReviewFilter.AllCards
                ),
                workspaceId = reviewRouteWorkspaceId,
                onSelectFilter = { workspaceId, openingFilter, selectedFilter ->
                    filterSelections += ReviewFilterSelection(
                        workspaceId = workspaceId,
                        openingFilter = openingFilter,
                        selectedFilter = selectedFilter
                    )
                },
                onOpenDeckManagement = {
                    openDeckManagementCalls += 1
                },
                onScreenVisible = {}
            )
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithTag(reviewFilterTagOptionTag(tag = reviewRouteFirstTag)).performClick()
        composeRule.onNodeWithTag(reviewManageDecksButtonTag).performClick()

        composeRule.onNodeWithTag(reviewFilterSheetTag).assertDoesNotExist()
        composeRule.runOnIdle {
            assertEquals(1, openDeckManagementCalls)
            assertEquals(
                listOf(
                    ReviewFilterSelection(
                        workspaceId = reviewRouteWorkspaceId,
                        openingFilter = ReviewFilter.AllCards,
                        selectedFilter = ReviewFilter.Tags(tags = listOf(reviewRouteSecondTag))
                    )
                ),
                filterSelections
            )
        }
    }

    @Test
    fun reviewFilterDraftIsDiscardedWhenWorkspaceOrCommittedFilterChanges() {
        var uiState by mutableStateOf(
            value = reviewRouteUiState(
                isLoading = false,
                requestedFilter = ReviewFilter.AllCards
            )
        )
        var workspaceId by mutableStateOf(value = reviewRouteWorkspaceId)
        val filterSelections = mutableListOf<ReviewFilterSelection>()

        composeRule.setContent {
            ReviewRouteTestContent(
                uiState = uiState,
                workspaceId = workspaceId,
                onSelectFilter = { selectedWorkspaceId, openingFilter, selectedFilter ->
                    filterSelections += ReviewFilterSelection(
                        workspaceId = selectedWorkspaceId,
                        openingFilter = openingFilter,
                        selectedFilter = selectedFilter
                    )
                },
                onOpenDeckManagement = {},
                onScreenVisible = {}
            )
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithTag(reviewFilterAllCardsOptionTag).performClick()
        composeRule.runOnIdle {
            workspaceId = "replacement-workspace"
        }
        composeRule.onNodeWithTag(reviewFilterSheetTag).assertDoesNotExist()

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithTag(reviewFilterAllCardsOptionTag).performClick()
        composeRule.runOnIdle {
            uiState = reviewRouteUiState(
                isLoading = false,
                requestedFilter = ReviewFilter.Tags(tags = listOf(reviewRouteFirstTag))
            )
        }
        composeRule.onNodeWithTag(reviewFilterSheetTag).assertDoesNotExist()
        composeRule.runOnIdle {
            assertTrue(filterSelections.isEmpty())
        }
    }

    @Test
    fun reviewFilterCannotOpenWhileReviewIsLoading() {
        composeRule.setContent {
            ReviewRouteTestContent(
                uiState = reviewRouteUiState(
                    isLoading = true,
                    requestedFilter = ReviewFilter.AllCards
                ),
                workspaceId = reviewRouteWorkspaceId,
                onSelectFilter = { _, _, _ -> },
                onOpenDeckManagement = {},
                onScreenVisible = {}
            )
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).assertIsNotEnabled()
        composeRule.onNodeWithTag(reviewFilterSheetTag).assertDoesNotExist()
    }

    @Test
    fun reviewFilterDraftRestoresBeforeDismissal() {
        val stateRestorationTester = StateRestorationTester(composeRule)
        val filterSelections = mutableListOf<ReviewFilterSelection>()

        stateRestorationTester.setContent {
            ReviewRouteTestContent(
                uiState = reviewRouteUiState(
                    isLoading = false,
                    requestedFilter = ReviewFilter.AllCards
                ),
                workspaceId = reviewRouteWorkspaceId,
                onSelectFilter = { workspaceId, openingFilter, selectedFilter ->
                    filterSelections += ReviewFilterSelection(
                        workspaceId = workspaceId,
                        openingFilter = openingFilter,
                        selectedFilter = selectedFilter
                    )
                },
                onOpenDeckManagement = {},
                onScreenVisible = {}
            )
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithTag(reviewFilterTagOptionTag(tag = reviewRouteFirstTag)).performClick()
        stateRestorationTester.emulateSavedInstanceStateRestore()

        composeRule.onNodeWithTag(reviewFilterSheetTag).assertIsDisplayed()
        composeRule.onNodeWithTag(reviewFilterTagOptionTag(tag = reviewRouteFirstTag)).assertIsOff()
        composeRule.onNodeWithTag(reviewFilterTagOptionTag(tag = reviewRouteSecondTag)).assertIsOn()
        composeRule.runOnIdle {
            assertTrue(filterSelections.isEmpty())
        }

        pressBack()
        composeRule.runOnIdle {
            assertEquals(1, filterSelections.size)
        }
    }
}

private const val reviewRouteWorkspaceId = "review-route-test-workspace"
private const val reviewRouteFirstTag = "Alpha"
private const val reviewRouteSecondTag = "Beta"

private data class ReviewFilterSelection(
    val workspaceId: String,
    val openingFilter: ReviewFilter,
    val selectedFilter: ReviewFilter
)

@Composable
private fun ReviewRouteTestContent(
    uiState: ReviewUiState,
    workspaceId: String?,
    onSelectFilter: (String, ReviewFilter, ReviewFilter) -> Unit,
    onOpenDeckManagement: () -> Unit,
    onScreenVisible: () -> Unit
) {
    FlashcardsTheme {
        val reviewReactionLottieConfigurationStore =
            rememberReviewReactionLottieConfigurationStore(loadLottieCompositions = true)
        ReviewRoute(
            uiState = uiState,
            workspaceId = workspaceId,
            reviewReactionLottieConfigurationStore = reviewReactionLottieConfigurationStore,
            reviewReactionAnimationsEnabled = false,
            onSelectFilter = onSelectFilter,
            onOpenPreview = {},
            onOpenCurrentCard = {},
            onOpenCurrentCardWithAi = { _, _, _, _ -> },
            onOpenDeckManagement = onOpenDeckManagement,
            onCreateCard = {},
            onCreateCardWithAi = {},
            onSwitchToAllCards = {},
            onLoadManagedMediaFile = { mediaAssetId ->
                throw UnsupportedOperationException(
                    "ReviewRouteTest does not load managed media files. mediaAssetId=$mediaAssetId"
                )
            },
            onLoadManagedMediaDownloadUrl = { mediaAssetId ->
                throw UnsupportedOperationException(
                    "ReviewRouteTest does not load managed media. mediaAssetId=$mediaAssetId"
                )
            },
            onRevealAnswer = {},
            onRateAgain = {},
            onRateHard = {},
            onRateGood = {},
            onRateEasy = {},
            onDismissHardAnswerReminder = {},
            onDismissErrorMessage = {},
            onDismissNotificationPermissionPrompt = {},
            onContinueNotificationPermissionPrompt = {},
            onOpenLeaderboard = {},
            onOpenProgress = {},
            onScreenVisible = onScreenVisible
        )
    }
}

private fun reviewRouteUiState(
    isLoading: Boolean,
    requestedFilter: ReviewFilter
): ReviewUiState {
    return ReviewUiState(
        isLoading = isLoading,
        requestedFilter = requestedFilter,
        selectedFilter = requestedFilter,
        selectedFilterTitle = "Review filter",
        remainingCount = 0,
        totalCount = 0,
        reviewedInSessionCount = 0,
        isAnswerVisible = false,
        currentCardIdForEditing = null,
        preparedCurrentCard = null,
        preparedNextCard = null,
        availableDeckFilters = emptyList(),
        availableTagFilters = listOf(
            ReviewTagFilterOption(tag = reviewRouteFirstTag, totalCount = 1),
            ReviewTagFilterOption(tag = reviewRouteSecondTag, totalCount = 1)
        ),
        reviewLeaderboardBadge = ReviewLeaderboardBadgeState(
            rank = null,
            windowKey = null,
            isInteractive = false
        ),
        reviewProgressBadge = ReviewProgressBadgeState(
            streakDays = 0,
            hasReviewedToday = false,
            isInteractive = false
        ),
        isPreviewLoading = false,
        previewItems = emptyList(),
        hasMorePreviewCards = false,
        emptyState = ReviewEmptyState.SESSION_COMPLETE,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

private fun <T> hasSemanticsValue(
    key: SemanticsPropertyKey<T>,
    expectedValue: T
): SemanticsMatcher {
    return SemanticsMatcher("Semantics ${key.name} equals $expectedValue") { node ->
        node.config.getOrNull(key) == expectedValue
    }
}
