package com.flashcardsopensourceapp.app.prompts.guestreview

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountSignInEmailDestination
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInEmailRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInUiState
import com.flashcardsopensourceapp.feature.settings.cloud.cloudSignInEmailFieldTag
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GuestSignInAfterReviewPromptDialogTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun laterDismissesDialog() {
        var isVisible by mutableStateOf(value = true)
        var laterCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                if (isVisible) {
                    GuestSignInAfterReviewPromptDialog(
                        onSignIn = {},
                        onLater = {
                            laterCalls += 1
                            isVisible = false
                        }
                    )
                }
            }
        }

        composeRule.onNodeWithTag(
            testTag = guestSignInAfterReviewPromptTag,
            useUnmergedTree = true
        ).assertIsDisplayed()
        composeRule.onNodeWithTag(
            testTag = guestSignInAfterReviewPromptLaterButtonTag,
            useUnmergedTree = true
        ).performClick()

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            laterCalls == 1 &&
                composeRule.onAllNodesWithTag(
                    testTag = guestSignInAfterReviewPromptTag,
                    useUnmergedTree = true
                ).fetchSemanticsNodes().isEmpty()
        }
        assertEquals(1, laterCalls)
    }

    @Test
    fun signInNavigatesToExistingEmailSignInRoute() {
        var signInCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                val navController = rememberNavController()

                NavHost(
                    navController = navController,
                    startDestination = "home"
                ) {
                    composable(route = "home") {
                        GuestSignInAfterReviewPromptDialog(
                            onSignIn = {
                                signInCalls += 1
                                navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                            },
                            onLater = {}
                        )
                    }
                    composable(route = SettingsAccountSignInEmailDestination.route) {
                        CloudSignInEmailRoute(
                            uiState = CloudSignInUiState(
                                email = "",
                                code = "",
                                isGuestUpgrade = true,
                                isSendingCode = false,
                                isVerifyingCode = false,
                                errorMessage = "",
                                errorTechnicalDetails = null,
                                challengeEmail = null
                            ),
                            onEmailChange = {},
                            onSendCode = {},
                            onBack = {
                                navController.popBackStack()
                            }
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithTag(
            testTag = guestSignInAfterReviewPromptSignInButtonTag,
            useUnmergedTree = true
        ).performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            signInCalls == 1 &&
                composeRule.onAllNodesWithTag(
                    testTag = cloudSignInEmailFieldTag,
                    useUnmergedTree = true
                ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(
            testTag = cloudSignInEmailFieldTag,
            useUnmergedTree = true
        ).assertIsDisplayed()
        assertEquals(1, signInCalls)
    }
}
