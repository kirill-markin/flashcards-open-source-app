package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.feature.review.PreparedReviewPreviewCardPresentation
import com.flashcardsopensourceapp.feature.review.R as ReviewR
import com.flashcardsopensourceapp.feature.review.ReviewPreviewListItem
import com.flashcardsopensourceapp.feature.review.ReviewPreviewRoute
import com.flashcardsopensourceapp.feature.review.ReviewUiState
import com.flashcardsopensourceapp.feature.settings.CloudSignInCodeRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInUiState
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RtlLayoutTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun cloudSignInCodeRoutePlacesBackButtonOnTrailingEdgeInRtl() {
        setRtlContent {
            CloudSignInCodeRoute(
                uiState = CloudSignInUiState(
                    email = "rtl@example.com",
                    code = "",
                    isGuestUpgrade = false,
                    isSendingCode = false,
                    isVerifyingCode = false,
                    errorMessage = "",
                    errorTechnicalDetails = null,
                    challengeEmail = "rtl@example.com"
                ),
                onCodeChange = { _ -> },
                onVerifyCode = {},
                onBack = {}
            )
        }

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_sign_in_verify_title)).assertIsDisplayed()
        composeRule.onNodeWithText("rtl@example.com", substring = true).assertIsDisplayed()
        assertNodeIsOnRightHalf(
            contentDescription = settingsString(SettingsR.string.settings_back_content_description)
        )
    }

    @Test
    fun reviewPreviewRouteDisplaysMixedDirectionContentInRtl() {
        val previewTitle = "بطاقات SQL"
        val sectionTitle = "اليوم / Today"
        val frontText = "ما هو SQL?"
        val backText = "Answer: SELECT * FROM cards;"
        val tagsLabel = "db, sql"

        setRtlContent {
            ReviewPreviewRoute(
                uiState = ReviewUiState(
                    isLoading = false,
                    selectedFilter = ReviewFilter.AllCards,
                    selectedFilterTitle = previewTitle,
                    remainingCount = 1,
                    totalCount = 1,
                    reviewedInSessionCount = 0,
                    isAnswerVisible = false,
                    currentCardIdForEditing = null,
                    preparedCurrentCard = null,
                    preparedNextCard = null,
                    availableDeckFilters = emptyList(),
                    availableEffortFilters = emptyList(),
                    availableTagFilters = emptyList(),
                    isPreviewLoading = false,
                    previewItems = listOf(
                        ReviewPreviewListItem.SectionHeader(
                            itemId = "section-today",
                            title = sectionTitle
                        ),
                        ReviewPreviewListItem.CardEntry(
                            presentation = PreparedReviewPreviewCardPresentation(
                                card = ReviewCard(
                                    cardId = "card-rtl-preview",
                                    frontText = frontText,
                                    backText = backText,
                                    tags = listOf("db", "sql"),
                                    effortLevel = EffortLevel.FAST,
                                    dueAtMillis = null,
                                    updatedAtMillis = 1L,
                                    createdAtMillis = 1L,
                                    reps = 0,
                                    lapses = 0,
                                    queueStatus = ReviewCardQueueStatus.ACTIVE
                                ),
                                effortLabel = "Fast",
                                tagsLabel = tagsLabel,
                                dueLabel = "Today",
                                backText = backText
                            ),
                            isCurrent = true
                        )
                    ),
                    hasMorePreviewCards = false,
                    emptyState = null,
                    previewErrorMessage = "",
                    errorMessage = "",
                    isNotificationPermissionPromptVisible = false,
                    isHardAnswerReminderVisible = false
                ),
                onStartPreview = {},
                onLoadNextPreviewPageIfNeeded = { _ -> },
                onRetryPreview = {},
                onOpenCard = { _ -> },
                onBack = {}
            )
        }

        composeRule.onNodeWithText(previewTitle).assertIsDisplayed()
        composeRule.onNodeWithText(sectionTitle).assertIsDisplayed()
        composeRule.onNodeWithText(frontText).assertIsDisplayed()
        composeRule.onNodeWithText(backText).assertIsDisplayed()
        composeRule.onNodeWithText(tagsLabel).assertIsDisplayed()
        assertNodeIsOnRightHalf(
            contentDescription = reviewString(ReviewR.string.review_preview_back_content_description)
        )
    }

    private fun setRtlContent(content: @Composable () -> Unit) {
        composeRule.setContent {
            FlashcardsTheme {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    content()
                }
            }
        }
    }

    private fun assertNodeIsOnRightHalf(contentDescription: String) {
        val rootBounds = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val nodeBounds = composeRule
            .onNodeWithContentDescription(contentDescription)
            .fetchSemanticsNode()
            .boundsInRoot
        val rootCenterX = (rootBounds.left + rootBounds.right) / 2f

        assertTrue(
            "Expected node \"$contentDescription\" to render on the right half in RTL. Bounds=$nodeBounds root=$rootBounds",
            nodeBounds.right > rootCenterX
        )
    }

    private fun reviewString(resourceId: Int): String {
        return composeRule.activity.getString(resourceId)
    }

    private fun settingsString(resourceId: Int): String {
        return composeRule.activity.getString(resourceId)
    }
}
